import type { ResearchDesign } from '../schemas/researchDesign';
import type { ExperimentPlan } from '../researchDesign/plan/schema';
import { validatePlan } from '../researchDesign/plan/validatePlan';
import { sourceHash } from '../text/hash';
import { acceptedInputs, contentOf, currentArtifact, matchesDesignSource } from './artifacts';
import type { Run } from './record';
import { beginStage, decideGate, openGate, putArtifact, RunTransitionError } from './run';
import { checkResultCoverage } from './results-input';

export async function planEtag(plan: ExperimentPlan) {
  return (await sourceHash(JSON.stringify(plan))).slice('sha256:'.length);
}

export function checkLockPlan(run: Run, plan: ExperimentPlan) {
  const artifact = currentArtifact(run, 'S10');
  const link = plan.context?.autoresearch;
  const hypotheses = acceptedInputs(run, 'S10').S8?.hypotheses ?? [];
  if (
    artifact?.status !== 'accepted' ||
    plan.planId !== run.projectId ||
    !link ||
    !matchesDesignSource(link, run.id, artifact) ||
    hypotheses.length !== link.hypotheses.length ||
    hypotheses.some(
      (h) =>
        !link.hypotheses.some(
          (item) =>
            item.sourceId === h.id &&
            item.criterion === h.falsification.criterion &&
            item.threshold === h.falsification.threshold &&
            item.prediction === h.prediction &&
            item.estimand === h.estimand &&
            item.outcome === h.outcome &&
            plan.hypotheses.some((row) => row.id === item.id && row.statement === h.statement),
        ),
    ) ||
    validatePlan(plan).some(({ level }) => level === 'blocking')
  )
    throw new RunTransitionError('Frozen plan does not match the accepted AutoResearch design');
  checkResultCoverage(contentOf('S10', artifact), plan);
}

export async function recordPlanLock(run: Run, record: ResearchDesign, planVersion: number, at: string) {
  const plan = record.frozenPlans.find((p) => p.planVersion === planVersion);
  if (!plan || record.projectId !== run.projectId) throw new RunTransitionError('Frozen plan not found');
  checkLockPlan(run, plan);
  const priorLock = run.artifacts.findLast((artifact) => artifact.stage === 'S11' && artifact.selectionHash);
  const previousVersion = priorLock ? contentOf('S11', priorLock).planVersion : 0;
  const etag = await planEtag(plan);
  if (
    priorLock?.status === 'accepted' &&
    previousVersion === planVersion &&
    contentOf('S11', priorLock).etag === etag
  )
    return run;
  if (
    previousVersion > planVersion ||
    (previousVersion === planVersion && priorLock && contentOf('S11', priorLock).etag !== etag) ||
    (previousVersion > 0 && planVersion > previousVersion && !plan.deviation) ||
    run.status === 'running' ||
    run.pipeline.some((row) => row.state === 'working' && row.stage !== 'S12') ||
    (run.status === 'ended' && (run.endReason === 'cancelled' || run.endReason === 'failed'))
  )
    throw new RunTransitionError('A deviation needs a new frozen plan and a human note');
  const publishedAt = record.publishedPlans?.[String(planVersion)]?.publishedAt;
  const reopened = { ...run, status: 'waiting' as const, endReason: null, endedAt: null };
  const working = await beginStage(reopened, 'S11', null, at);
  const recorded = await putArtifact(
    working,
    'S11',
    {
      planVersion,
      etag,
      frozenAt: plan.frozenAt,
      ...(publishedAt && { publishedAt }),
    },
    at,
    'person',
  );
  const accepted = await decideGate(
    openGate(recorded, 'S11', at),
    'S11',
    {
      approve: true,
      ids: [],
      primaryId: null,
      note: plan.deviation,
    },
    at,
  );
  return {
    ...accepted,
    decisions: accepted.decisions.map((entry, i) =>
      i === accepted.decisions.length - 1
        ? {
            ...entry,
            action:
              previousVersion && planVersion > previousVersion ? ('deviation' as const) : ('lock' as const),
          }
        : entry,
    ),
  };
}

export async function linkedFrozenPlan(run: Run, record: ResearchDesign) {
  const artifact = currentArtifact(run, 'S11');
  if (artifact?.status !== 'accepted' || record.projectId !== run.projectId)
    throw new RunTransitionError('S11 requires a linked frozen plan');
  const lock = contentOf('S11', artifact);
  const plan = record.frozenPlans.find((p) => p.planVersion === lock.planVersion);
  if (
    record.frozenPlans.some(
      (p) => p.planVersion > lock.planVersion && p.context?.autoresearch?.runId === run.id,
    )
  )
    throw new RunTransitionError('Link the newest frozen plan before analyzing results');
  if (!plan || (await planEtag(plan)) !== lock.etag || plan.frozenAt !== lock.frozenAt)
    throw new RunTransitionError('Frozen plan ETag does not match the lock');
  checkLockPlan(run, plan);
  return plan;
}
