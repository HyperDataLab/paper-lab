import { contentOf, currentArtifact, currentResultsImport } from '@/core/autoresearch/artifacts';
import type { Run } from '@/core/autoresearch/record';
import type { ResearchDesign } from '@/core/schemas/researchDesign';

export function experimentStageState(run: Run, design: ResearchDesign | null) {
  const lock = currentArtifact(run, 'S11');
  const version = lock?.status === 'accepted' ? contentOf('S11', lock).planVersion : undefined;
  const plan = design?.frozenPlans.at(-1);
  const newerLock =
    version !== undefined && plan?.context?.autoresearch?.runId === run.id && plan.planVersion > version;
  const deviation = design?.planDeviation?.runId === run.id ? design.planDeviation : undefined;
  const available = run.endReason !== 'cancelled' && run.endReason !== 'failed';
  const canLock =
    available &&
    run.status !== 'running' &&
    !run.pipeline.some((row) => row.state === 'working' && row.stage !== 'S12') &&
    currentArtifact(run, 'S10')?.status === 'accepted';
  return {
    canLock,
    pendingLock: canLock && (!lock || !!deviation || newerLock),
    deviation,
    lock: available && !newerLock ? lock : undefined,
    log: !newerLock ? currentResultsImport(run) : undefined,
    publishedAt: version === undefined ? undefined : design?.publishedPlans?.[String(version)]?.publishedAt,
  };
}
