import { canonicalDigest } from '../corpus';
import {
  acceptedInputs,
  canResume,
  checkpointDigest,
  contentOf,
  currentArtifact,
  inputHashes,
  selectable,
  selectionDigest,
} from './artifacts';
import { charterSchema, contracts, STAGES, type Charter, type Stage, type StageContent } from './contracts';
import {
  artifactSchema,
  emptyStage,
  type Artifact,
  type EndReason,
  type Run,
  type StageState,
} from './record';
import { carryObligations, closeObligations } from './obligations';
import { passStage } from './validation';

export class RunTransitionError extends Error {}

export function newRun(projectId: string, id: string, maxCalls: number, at: string): Run {
  return {
    schemaVersion: 1,
    id,
    projectId,
    revision: 0,
    status: 'waiting',
    endReason: null,
    charter: null,
    charterHash: null,
    pipeline: STAGES.map((stage) => emptyStage(stage, 0)),
    artifacts: [],
    notebook: [],
    obligations: [],
    decisions: [],
    budget: { calls: 0, maxCalls, estimatedCost: null },
    createdAt: at,
    updatedAt: at,
    endedAt: null,
  };
}

export function stageState(run: Run, stage: Stage) {
  const state = run.pipeline.find((row) => row.stage === stage);
  if (!state) throw new RunTransitionError('Missing pipeline stage');
  return state;
}
export function patchStage(run: Run, stage: Stage, patch: Partial<StageState>): Run {
  return { ...run, pipeline: run.pipeline.map((row) => (row.stage === stage ? { ...row, ...patch } : row)) };
}
export function nextStage(run: Run) {
  return run.pipeline.find((row) => row.state !== 'accepted');
}

export function invalidateFrom(run: Run, stage: Stage): Run {
  const index = STAGES.indexOf(stage);
  return {
    ...run,
    artifacts: run.artifacts.map((a) => (STAGES.indexOf(a.stage) < index ? a : { ...a, status: 'stale' })),
    obligations: run.obligations.map((o) =>
      STAGES.indexOf(o.targetStage) < index || o.status !== 'controlled'
        ? o
        : { ...o, status: 'open', locator: null, note: null },
    ),
    pipeline: run.pipeline.map((row) =>
      STAGES.indexOf(row.stage) < index || row.state === 'idle' ? row : { ...row, state: 'stale' },
    ),
  };
}

export async function approveCharter(
  run: Run,
  charter: Charter,
  at: string,
  note: string | null,
): Promise<Run> {
  if (run.status !== 'waiting') throw new RunTransitionError('Run is busy or ended');
  const registered = charterSchema.parse(charter);
  const hash = await canonicalDigest(registered);
  if (run.charterHash === hash) return run;
  const hasResults = run.artifacts.length > 0;
  if (hasResults && !note?.trim()) throw new RunTransitionError('Charter escalation requires a note');
  return {
    ...invalidateFrom(run, 'S1'),
    charter: registered,
    charterHash: hash,
    decisions: [
      ...run.decisions,
      {
        stage: 'S1',
        attempt: 0,
        action: hasResults ? 'escalate' : 'charter',
        selectionIds: [],
        primaryId: null,
        note,
        at,
      },
    ],
  };
}

export async function beginStage(
  run: Run,
  stage: Stage,
  models: NonNullable<StageState['models']>,
  at: string,
): Promise<Run> {
  if (run.status !== 'waiting' || !run.charter || !(await canResume(run)))
    throw new RunTransitionError('Run cannot start until its charter and artifact hashes match');
  if (STAGES.slice(0, STAGES.indexOf(stage)).some((earlier) => stageState(run, earlier).state !== 'accepted'))
    throw new RunTransitionError('Earlier stages require approval');
  const previous = stageState(run, stage);
  if (previous.state === 'gate') throw new RunTransitionError('Human decision required');
  const state =
    previous.state === 'working'
      ? { ...previous, state: 'working' as const }
      : {
          ...emptyStage(stage, previous.attempt + 1),
          state: 'working' as const,
          models,
          previousCritic: previous.critic ?? previous.previousCritic,
          at,
        };
  return patchStage(
    { ...(previous.state === 'working' ? run : invalidateFrom(run, stage)), status: 'running' },
    stage,
    { ...state, checkpointHash: await checkpointDigest(state) },
  );
}

export async function putArtifact<K extends Stage>(
  run: Run,
  stage: K,
  content: StageContent[K],
  at: string,
  author: Artifact['author'] = stage === 'S4' ? 'code' : 'model',
) {
  const state = stageState(run, stage);
  if (run.status !== 'running' || state.state !== 'working' || currentArtifact(run, stage))
    throw new RunTransitionError('Stage is inactive or already has an artifact');
  const value = contracts[stage].parse(content);
  const cards =
    stage === 'S6'
      ? contracts.S6.parse(value).cards
      : stage === 'S7' || stage === 'S8' || stage === 'S9'
        ? acceptedInputs(run, stage).S6?.cards
        : undefined;
  const scopes = new Set(cards?.map(({ evidence_scope }) => evidence_scope));
  const artifact = artifactSchema.parse({
    stage,
    attempt: state.attempt,
    schemaVersion: 1,
    content: value,
    hash: await canonicalDigest(value),
    charterHash: run.charterHash,
    inputHashes: inputHashes(run, stage),
    status: 'draft',
    selectionIds: null,
    selectionHash: null,
    primaryId: null,
    evidence_scope: scopes.size === 1 ? ([...scopes][0] ?? null) : null,
    author,
    model: author === 'model' ? (state.models?.lead ?? null) : null,
    promptVersion: author === 'person' ? null : (state.models?.stagePrompt ?? null),
    createdAt: at,
  });
  return { ...run, artifacts: [...run.artifacts, artifact] };
}

export function openGate(run: Run, stage: Stage, at: string): Run {
  if (run.status !== 'running' || stageState(run, stage).state !== 'working')
    throw new RunTransitionError('Stage is inactive');
  return patchStage({ ...run, status: 'waiting' }, stage, { state: 'gate', at });
}

export function checkObligation(
  run: Run,
  id: string,
  status: 'controlled' | 'unresolved',
  stage: Stage,
  note: string,
): Run {
  const obligation = run.obligations.find((item) => item.id === id);
  const artifact = currentArtifact(run, stage);
  if (
    run.status !== 'waiting' ||
    !obligation ||
    !note.trim() ||
    STAGES.indexOf(stage) < STAGES.indexOf(obligation.targetStage) ||
    (status === 'controlled' && (!artifact || stageState(run, stage).error !== null))
  )
    throw new RunTransitionError('Obligation needs a note and a valid artifact to be controlled');
  return {
    ...run,
    obligations: run.obligations.map((item) =>
      item.id === id
        ? {
            ...item,
            status,
            targetStage: stage,
            locator: status === 'controlled' && artifact ? artifact.hash : null,
            note,
          }
        : item,
    ),
  };
}

export async function decideGate(
  run: Run,
  stage: Stage,
  choice: {
    approve: boolean;
    ids: string[];
    primaryId: string | null;
    note: string | null;
  },
  at: string,
): Promise<Run> {
  const state = stageState(run, stage);
  if (run.status !== 'waiting' || state.state !== 'gate') throw new RunTransitionError('Gate is closed');
  const artifact = currentArtifact(run, stage);
  const items = selectable(artifact);
  const ids = choice.approve ? choice.ids : [];
  const primaryId = choice.approve ? choice.primaryId : null;
  if (choice.approve) {
    if (
      !artifact ||
      state.error ||
      !(await canResume(run)) ||
      passStage(stage, contentOf(stage, artifact), acceptedInputs(run, stage))
    )
      throw new RunTransitionError('Stage conditions must pass before approval');
    if (
      new Set(ids).size !== ids.length ||
      (items.length > 0 && ids.length === 0) ||
      ids.some((id) => !items.some((item) => item.id === id)) ||
      (stage === 'S8' ? !primaryId || !ids.includes(primaryId) : primaryId !== null)
    )
      throw new RunTransitionError('Invalid gate selection');
  } else if (!choice.note?.trim()) throw new RunTransitionError('Rejection requires a note');
  let next = patchStage(
    {
      ...(choice.approve ? run : invalidateFrom(run, stage)),
      decisions: [
        ...run.decisions,
        {
          stage,
          attempt: state.attempt,
          action: choice.approve ? 'approve' : 'reject',
          selectionIds: ids,
          primaryId,
          note: choice.note,
          at,
        },
      ],
    },
    stage,
    { state: choice.approve ? 'accepted' : 'rejected', at },
  );
  if (choice.approve && artifact) {
    const accepted = { ...artifact, status: 'accepted' as const, selectionIds: ids, primaryId };
    accepted.selectionHash = await selectionDigest(accepted);
    next = {
      ...next,
      artifacts: next.artifacts.map((a) => (a === artifact ? accepted : a)),
      obligations: carryObligations(next, state),
    };
  }
  return stage === STAGES.at(-1) && choice.approve
    ? endRun(
        next,
        next.obligations.some((o) => o.status !== 'controlled') ||
          next.pipeline.some((row) => row.reviewError !== null)
          ? 'with_gaps'
          : 'complete',
        at,
      )
    : next;
}

export function endRun(run: Run, reason: EndReason, at: string): Run {
  if (run.status === 'ended') throw new RunTransitionError('Run already ended');
  if ((reason === 'complete' || reason === 'with_gaps') && nextStage(run))
    throw new RunTransitionError('Every stage requires approval');
  return {
    ...run,
    status: 'ended',
    endReason: reason,
    endedAt: at,
    pipeline: run.pipeline.map((row) =>
      row.state === 'working' || row.state === 'gate' ? { ...row, state: 'rejected', at } : row,
    ),
    obligations: closeObligations(run),
  };
}
