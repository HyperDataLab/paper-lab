import type { Analysis, Issue, Revision } from '../schemas';
import { alignRevision } from '../revision/align';
import { meaningChecks } from '../revision/meaningChecks';
import { sliceCp } from '../text/offsets';

function metrics(
  analysis: Analysis,
): Record<string, { numerator: number; denominator: number; value: number | null }> {
  const values = analysis.paragraphMetrics;
  if (!values) return {};
  const { topic_continuity_pattern, ...rest } = values;
  return {
    ...rest,
    ...Object.fromEntries(
      Object.entries(topic_continuity_pattern).map(([key, value]) => [
        `topic_continuity_pattern.${key}`,
        value,
      ]),
    ),
  };
}

function issueKey(issue: Issue, text: string) {
  return JSON.stringify([issue.type, issue.spans.map((span) => sliceCp(text, span.start, span.end))]);
}

export function compareAnalyses(a: Analysis, b: Analysis, revision?: Revision | null) {
  const before = metrics(a);
  const after = metrics(b);
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const metricDeltas = names.map((name) => {
    const left = before[name] ?? null;
    const right = after[name] ?? null;
    return {
      name,
      before: left,
      after: right,
      delta: left?.value != null && right?.value != null ? right.value - left.value : null,
    };
  });
  const scoreDeltas = (a.scores?.dimensions ?? []).flatMap((left) => {
    const right = b.scores?.dimensions.find((item) => item.id === left.id);
    return left.applicable && right?.applicable && left.score != null && right.score != null
      ? [{ id: left.id, before: left.score, after: right.score, delta: right.score - left.score }]
      : [];
  });
  const matched = new Set<number>();
  const resolved: Issue[] = [];
  const persisting: Issue[] = [];
  for (const issue of a.issues) {
    const key = issueKey(issue, a.text.sourceText);
    const index = b.issues.findIndex(
      (candidate, position) => !matched.has(position) && issueKey(candidate, b.text.sourceText) === key,
    );
    if (index < 0) resolved.push(issue);
    else {
      matched.add(index);
      persisting.push(issue);
    }
  }
  const matchesRevision = (source: Analysis, revised: Analysis) =>
    revision &&
    revised.origin?.kind === 'revision' &&
    revised.origin.revisionId === revision.id &&
    revision.sourceAnalysisId === source.id &&
    revision.sourceHash === source.text.sourceHash &&
    revision.revisedHash === revised.text.sourceHash &&
    revision.revisedText === revised.text.sourceText;
  const storedChecks = revision && (matchesRevision(a, b) || matchesRevision(b, a)) ? revision.checks : null;
  return {
    diff: alignRevision(a.text.sourceText, b.text.sourceText),
    metricDeltas,
    scoreDeltas,
    issues:
      a.versions.detectors && b.versions.detectors
        ? { resolved, persisting, new: b.issues.filter((_, index) => !matched.has(index)) }
        : null,
    checks: storedChecks ?? meaningChecks(a.text.sourceText, b.text.sourceText, []),
    checksSource: storedChecks ? ('stored_revision' as const) : ('recomputed' as const),
  };
}
