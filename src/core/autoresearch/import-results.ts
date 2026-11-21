import { canonicalDigest } from '../corpus';
import type { ResearchDesign } from '../schemas/researchDesign';
import { acceptedInputs, currentResultsImport } from './artifacts';
import { linkedFrozenPlan, planEtag } from './lock';
import type { Run } from './record';
import { normalizeResultsLog, parseResultsLog } from './results-input';
import { invalidateFrom, RunTransitionError } from './run';

export async function importResults(
  run: Run,
  record: ResearchDesign,
  raw: string,
  format: 'json' | 'csv',
): Promise<Run> {
  if (
    run.status !== 'waiting' &&
    !(run.status === 'ended' && ['complete', 'with_gaps'].includes(run.endReason ?? ''))
  )
    throw new RunTransitionError('Wait for the current stage before importing results');
  const plan = await linkedFrozenPlan(run, record);
  const design = acceptedInputs(run, 'S12').S10;
  if (!design) throw new RunTransitionError('S10 must be accepted');
  const log = parseResultsLog(raw, format);
  normalizeResultsLog(log, design, plan);
  const hash = await canonicalDigest(log);
  const etag = await planEtag(plan);
  if (currentResultsImport(run)?.hash === hash) return run;
  return {
    ...invalidateFrom(run, 'S12'),
    status: 'waiting',
    endReason: null,
    endedAt: null,
    resultsImports: [...(run.resultsImports ?? []), { hash, etag, log }],
  };
}
