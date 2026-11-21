import type { PaperChecksRecord } from '@/core/schemas';
import type { FindingStatus, PaperFinding } from '@/core/paperFindings';
import type { Repositories } from '@/shared/storage/types';

/** The status an issue had before the reader's own decision, read back from the audit log. */
async function previousStatus(
  repo: Repositories,
  analysisId: string,
  issueId: string,
  transition: boolean,
): Promise<'candidate' | 'confirmed_by_model'> {
  const { items } = await repo.audit.listByAnalysis(analysisId);
  const event = items.findLast((entry) => {
    if (entry.issueId !== issueId) return false;
    if (transition ? entry.action !== 'review_transition' : !['confirm', 'dismiss'].includes(entry.action))
      return false;
    return (
      entry.before !== null &&
      typeof entry.before === 'object' &&
      'status' in entry.before &&
      (entry.before.status === 'candidate' || entry.before.status === 'confirmed_by_model')
    );
  });
  return event?.before &&
    typeof event.before === 'object' &&
    'status' in event.before &&
    event.before.status === 'confirmed_by_model'
    ? 'confirmed_by_model'
    : 'candidate';
}

/**
 * Stores the reader's decision on one finding in the record it came from. Returns nothing for a finding that
 * cannot take a decision.
 */
export function decideFinding(
  repo: Repositories,
  paperId: string,
  finding: PaperFinding,
  status: FindingStatus,
  onChecks: (record: PaperChecksRecord) => void,
): Promise<unknown> | undefined {
  const next: 'candidate' | 'confirmed_by_human' | 'dismissed_by_human' =
    status === 'confirmed'
      ? 'confirmed_by_human'
      : status === 'dismissed'
        ? 'dismissed_by_human'
        : 'candidate';
  const itemId = finding.id.slice(finding.source.length + 1);
  if (finding.source === 'checks') return repo.paperChecks.review(paperId, itemId, next).then(onChecks);
  if (finding.source === 'review') return repo.paperReviews.review(paperId, itemId, next);
  if (finding.source === 'transition')
    return (status === 'open' ? previousStatus(repo, paperId, itemId, true) : Promise.resolve(next)).then(
      (restored) => repo.paperOverviews.reviewTransition(paperId, itemId, restored),
    );
  if (finding.source === 'writing') {
    const separator = itemId.indexOf(':');
    const analysisId = itemId.slice(0, separator);
    const issueId = itemId.slice(separator + 1);
    return (
      status === 'open' ? previousStatus(repo, analysisId, issueId, false) : Promise.resolve(next)
    ).then((restored) => repo.analyses.reviewIssue(analysisId, issueId, { status: restored }));
  }
  if (finding.runId)
    return repo.measurements.decide(paperId, {
      run_id: finding.runId,
      item_id: itemId,
      field: null,
      decision: status === 'confirmed' ? 'accept' : status === 'dismissed' ? 'reject' : 'reopen',
      previous_value: null,
      new_value: null,
      note: null,
    });
  return undefined;
}
