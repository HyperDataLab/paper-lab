import { canonicalDigest } from '../corpus';
import { acceptedInputs, contentOf, currentArtifact } from './artifacts';
import { contracts, type Stage } from './contracts';
import type { Run, StageState } from './record';
import { beginStage, patchStage, putArtifact, RunTransitionError, stageState } from './run';
import { passStage } from './validation';

export async function editArtifact(
  run: Run,
  stage: Stage,
  raw: unknown,
  models: NonNullable<StageState['models']>,
  at: string,
  note: string,
): Promise<Run> {
  const original = currentArtifact(run, stage);
  const state = stageState(run, stage);
  if (!original || stage === 'S4' || !note.trim() || (state.state !== 'accepted' && state.state !== 'gate'))
    throw new RunTransitionError('Stage or edit note is unavailable');
  const parsed = contracts[stage].safeParse(raw);
  if (!parsed.success) throw new RunTransitionError('Edited artifact does not match the stage schema');
  if (stage === 'S1' && (await canonicalDigest(contracts.S1.parse(parsed.data).charter)) !== run.charterHash)
    throw new RunTransitionError('The charter requires its own pinned approval');
  if (stage === 'S8') {
    const proposed = contracts.S8.parse(parsed.data);
    const base = contentOf('S8', original);
    if (
      (await canonicalDigest([proposed.retrievedPapers, proposed.noveltySearches])) !==
      (await canonicalDigest([base.retrievedPapers, base.noveltySearches]))
    )
      throw new RunTransitionError('Retrieved paper records are immutable');
  }
  const error = passStage(stage, parsed.data, acceptedInputs(run, stage));
  if (error) throw new RunTransitionError(error);
  const pending = state.state === 'gate' ? patchStage(run, stage, { state: 'rejected' }) : run;
  const started = await beginStage(pending, stage, models, at);
  const recorded = await putArtifact(started, stage, parsed.data, at, 'person');
  return {
    ...recorded,
    status: 'waiting',
    decisions: [
      ...recorded.decisions,
      {
        stage,
        attempt: stageState(recorded, stage).attempt,
        action: 'edit',
        selectionIds: [],
        primaryId: null,
        note: note.trim(),
        at,
      },
    ],
  };
}
