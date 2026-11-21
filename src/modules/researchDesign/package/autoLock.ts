import { contentOf, currentArtifact, matchesDesignSource } from '@/core/autoresearch/artifacts';
import { checkLockPlan } from '@/core/autoresearch/lock';
import type { Run } from '@/core/autoresearch/record';
import type { Gate } from '@/core/researchDesign/draft/freezeGate';
import type { ResearchDesign } from '@/core/schemas/researchDesign';

export function autoLockState(design: ResearchDesign, gate: Gate, run?: Run) {
  const previous = design.frozenPlans.at(-1);
  const source = previous?.context?.autoresearch;
  const sourceRun = design.draft.autoresearchDesign?.context.runId ?? source?.runId;
  if (!run) return { sourceRun, reconnect: false, lockError: '' };
  const experiment = currentArtifact(run, 'S10');
  const lock = currentArtifact(run, 'S11');
  const reconnect =
    previous &&
    source &&
    experiment?.status === 'accepted' &&
    matchesDesignSource(source, run.id, experiment) &&
    (lock?.status !== 'accepted' || contentOf('S11', lock).planVersion < previous.planVersion);
  let lockError = '';
  if (gate.state === 'plan' && !gate.blocked && (!gate.unchanged || design.planDeviation)) {
    try {
      checkLockPlan(run, gate.plan);
    } catch (cause) {
      lockError = cause instanceof Error ? cause.message : String(cause);
    }
  }
  return { sourceRun, reconnect, lockError };
}
