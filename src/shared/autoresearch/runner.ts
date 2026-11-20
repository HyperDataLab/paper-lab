import {
  acceptedInputs,
  canResume,
  checkpointDigest,
  contentOf,
  currentArtifact,
  currentResultsImport,
} from '@/core/autoresearch/artifacts';
import { contracts, STAGES, type Stage, type StageError } from '@/core/autoresearch/contracts';
import type { Run, StageState } from '@/core/autoresearch/record';
import { linkedFrozenPlan } from '@/core/autoresearch/lock';
import { ResultsLogError } from '@/core/autoresearch/results-input';
import type { ResearchDesign } from '@/core/schemas/researchDesign';
import {
  beginStage,
  openGate,
  patchStage,
  putArtifact,
  RunTransitionError,
  stageState,
} from '@/core/autoresearch/run';
import { passStage } from '@/core/autoresearch/validation';
import { PROMPT_VERSIONS as versions } from '@/core/prompts';
import type { LlmClient } from '@/shared/llm/client';
import {
  ConsentRequiredError,
  InvalidModelOutputError,
  LlmHttpError,
  LlmTimeoutError,
} from '@/shared/llm/errors';
import { RemoteStorageError, StorageConflictError } from '@/shared/storage/errors';
import { executeEngine, StageFailure, stagePrompts, type Ask } from './engines';
import { supervise } from './supervisors';
import type { Screen } from './screening';

type EngineDeps = Parameters<typeof executeEngine>[1];
type ReviewDeps = Parameters<typeof supervise>[2];
type RunnerDeps = Pick<EngineDeps, 'collect' | 'search' | 'loadFullTexts' | 'bank'> &
  Pick<ReviewDeps, 'now' | 'signal' | 'read'> & {
    lead: { model: string; client: LlmClient };
    critic: { model: string; client: LlmClient };
    requireConsent: () => void;
    researchDesign?: ResearchDesign;
    save: (run: Run) => Promise<Run>;
    checkpoint?: (run: Run) => Promise<Run>;
    flush?: (id: string) => Promise<void>;
    screen: (options: {
      completed: StageState['screeningProgress'];
      checkpoint: (decisions: StageState['screeningProgress']) => Promise<void>;
      onRequest: () => Promise<void>;
    }) => Screen;
  };

export function errorCode(error: unknown): StageError {
  if (error instanceof StageFailure) return error.code;
  if (error instanceof ResultsLogError) return 'INVALID_RESULTS';
  if (error instanceof InvalidModelOutputError) return 'LLM_OUTPUT_INVALID';
  if (error instanceof LlmTimeoutError) return 'LLM_TIMEOUT';
  if (error instanceof LlmHttpError && error.status === 429) return 'LLM_RATE_LIMITED';
  return 'STAGE_ERROR';
}

export function modelsFor(stage: Stage, lead: string, critic: string) {
  return {
    lead,
    critic,
    sharedModel: lead === critic,
    stagePrompt: stagePrompts[stage],
    piPrompt: stage === 'S12' ? versions.autoresearchS12Pi : versions.autoresearchPi,
    criticPrompt: stage === 'S12' ? versions.autoresearchS12Critic : versions.autoresearchCritic,
  };
}

export async function runStage(initial: Run, stage: Stage, deps: RunnerDeps): Promise<Run> {
  try {
    return await executeStage(initial, stage, deps);
  } finally {
    await deps.flush?.(initial.id);
  }
}

async function executeStage(initial: Run, stage: Stage, deps: RunnerDeps): Promise<Run> {
  if (stage === 'S11') throw new RunTransitionError('S11 is a pinned person action');
  const { now, signal, requireConsent, lead, critic } = deps;
  signal?.throwIfAborted();
  requireConsent();
  let run = initial;
  const state = stageState(run, stage);
  const models = modelsFor(stage, lead.model, critic.model);
  if (run.status === 'running') {
    if (state.state !== 'working' || !(await canResume(run)))
      throw new RunTransitionError('Run cannot be resumed');
    run = { ...run, status: 'waiting' };
  }
  if (state.state === 'working' && JSON.stringify(state.models) !== JSON.stringify(models))
    throw new RunTransitionError('Interrupted stage requires its original models and prompt versions');
  run = await deps.save(await beginStage(run, stage, models, now()));
  const charter = run.charter;
  if (!charter) throw new StageFailure('MISSING_INPUT');
  const save = async (value: Run) => {
    run = await (deps.checkpoint ?? deps.save)(value);
  };
  const saveCheckpoint = async (record: Run, patch: Partial<StageState>) => {
    const next = patchStage(record, stage, patch);
    await save(patchStage(next, stage, { checkpointHash: await checkpointDigest(stageState(next, stage)) }));
  };
  const checkpoint = (patch: Partial<StageState>, record?: (run: Run) => Run) =>
    saveCheckpoint(record ? record(run) : run, patch);
  const onRequest = async () => {
    signal?.throwIfAborted();
    requireConsent();
    if (run.budget.calls >= run.budget.maxCalls) throw new StageFailure('STAGE_ERROR');
    await save({ ...run, budget: { ...run.budget, calls: run.budget.calls + 1 } });
  };
  const ask =
    (client: LlmClient): Ask =>
    async (schemaName, promptVersion, system, input, schema) => {
      signal?.throwIfAborted();
      requireConsent();
      const response = await client.completeJson({
        schemaName,
        promptVersion,
        system,
        user: JSON.stringify(input),
        schema,
        signal,
        onRequest,
      });
      signal?.throwIfAborted();
      const parsed = schema.safeParse(response.data);
      if (!parsed.success) throw new StageFailure('LLM_OUTPUT_INVALID');
      return parsed.data;
    };
  const storageFailure = (error: unknown) =>
    error instanceof StorageConflictError || error instanceof RemoteStorageError;
  const abortOrConflict = (error: unknown) =>
    signal?.aborted || storageFailure(error) || error instanceof ConsentRequiredError;
  try {
    if (!currentArtifact(run, stage) && !state.error) {
      const inputs = acceptedInputs(run, stage);
      try {
        const entry = stage === 'S12' ? currentResultsImport(run) : undefined;
        const experiment =
          entry && deps.researchDesign
            ? { entry, plan: await linkedFrozenPlan(run, deps.researchDesign) }
            : undefined;
        const result = await executeEngine(stage, {
          charter,
          inputs,
          state: stageState(run, stage),
          ask: ask(lead.client),
          collect: deps.collect,
          screen: deps.screen({
            completed: stageState(run, stage).screeningProgress,
            checkpoint: (screeningProgress) => checkpoint({ screeningProgress }),
            onRequest,
          }),
          search: deps.search,
          loadFullTexts: deps.loadFullTexts,
          checkpoint,
          bank: deps.bank,
          experiment,
          guidance: {
            directives: run.notebook.filter((entry) => entry.kind === 'directive').map((entry) => entry.text),
            handoff: run.pipeline[STAGES.indexOf(stage) - 1]?.pi?.handoff ?? [],
          },
        });
        signal?.throwIfAborted();
        const parsed = contracts[stage].safeParse(result);
        if (!parsed.success) throw new StageFailure(stageOutputError(stage));
        const withArtifact = await putArtifact(run, stage, parsed.data, now());
        const artifact = currentArtifact(withArtifact, stage);
        if (!artifact) throw new StageFailure('STAGE_ERROR');
        await saveCheckpoint(withArtifact, { error: passStage(stage, contentOf(stage, artifact), inputs) });
      } catch (error) {
        if (abortOrConflict(error)) throw error;
        const code = errorCode(error);
        await checkpoint({
          error: code === 'LLM_OUTPUT_INVALID' ? stageOutputError(stage) : code,
        });
      }
    }
    try {
      if (stage === 'S12' && stageState(run, stage).reviewError) await checkpoint({ reviewError: null });
      await supervise(stage, charter, {
        getRun: () => run,
        checkpoint,
        read: deps.read,
        askLead: ask(lead.client),
        askCritic: ask(critic.client),
        signal,
        now,
      });
    } catch (error) {
      if (abortOrConflict(error)) throw error;
      await checkpoint({ reviewError: errorCode(error) });
      if (stage === 'S12' && !stageState(run, stage).error) {
        await save({ ...run, status: 'waiting' });
        return run;
      }
    }
    signal?.throwIfAborted();
    await save(openGate(run, stage, now()));
  } catch (error) {
    if (storageFailure(error)) throw error;
    await save({ ...run, status: 'waiting' });
    if (!signal?.aborted) throw error;
  }
  return run;
}

function stageOutputError(stage: Stage): StageError {
  switch (stage) {
    case 'S6':
      return 'INVALID_CARDS';
    case 'S9':
      return 'INVALID_ARGUMENT_MAP';
    case 'S10':
      return 'INVALID_DESIGN';
    case 'S12':
      return 'INVALID_RESULTS';
    default:
      return 'LLM_OUTPUT_INVALID';
  }
}
