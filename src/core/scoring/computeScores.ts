import type { Issue } from '../schemas/issue';
import type { ScoringOutput } from '../prompts/scoring';
import type { Availability } from './availability';
import { DIMENSIONS, NOT_ASSESSABLE_LIMIT, RUBRIC_VERSION } from './rubric';

export function issueSnapshot(issues: Issue[]) {
  return issues
    .map((issue) => `${issue.id}:${issue.status}:${issue.severity}`)
    .sort()
    .join('|');
}
export function computeScores(
  raw: ScoringOutput,
  availability: Availability,
  issues: Issue[],
  meta: { sentenceIds: string[]; contextLimited: boolean },
) {
  const validIssues = new Set(
    issues.filter((issue) => issue.status !== 'dismissed_by_human').map((issue) => issue.id),
  );
  const validSentences = new Set(meta.sentenceIds);
  const dimensions = DIMENSIONS.map((dimension) => {
    const result = raw.dimensions.find((item) => item.id === dimension.id);
    const rubric = availability[dimension.id].applicable ? (result?.rubric ?? null) : null;
    const applicable = rubric !== null;
    return {
      id: dimension.id,
      label: dimension.label,
      weight: dimension.weight,
      applicable,
      notAssessableReason: applicable ? null : (availability[dimension.id].reason ?? 'AI không đủ căn cứ'),
      rubric,
      score: rubric === null ? null : Math.round((rubric / 4) * 1000) / 10,
      descriptor: rubric === null ? null : dimension.descriptors[rubric],
      confidence: applicable ? (result?.confidence ?? null) : null,
      evidence: {
        issueIds: applicable ? (result?.evidenceIssueIds ?? []).filter((id) => validIssues.has(id)) : [],
        sentenceIds: applicable
          ? (result?.evidenceSentenceIds ?? []).filter((id) => validSentences.has(id))
          : [],
      },
      rationale: applicable ? (result?.rationale ?? null) : null,
    };
  });
  const applicable = dimensions.filter((dimension) => dimension.applicable);
  const missing = dimensions.length - applicable.length;
  const weight = applicable.reduce((sum, dimension) => sum + dimension.weight, 0);
  const confidences = applicable.filter((dimension) => dimension.confidence !== null);
  const confidenceWeight = confidences.reduce((sum, dimension) => sum + dimension.weight, 0);
  return {
    rubricVersion: RUBRIC_VERSION,
    dimensions,
    overall:
      missing >= NOT_ASSESSABLE_LIMIT || !weight
        ? null
        : Math.round(
            (applicable.reduce((sum, dimension) => sum + (dimension.score ?? 0) * dimension.weight, 0) /
              weight) *
              10,
          ) / 10,
    overallSuppressedReason:
      missing >= NOT_ASSESSABLE_LIMIT
        ? `Không tính điểm tổng: ${missing} tiêu chí chưa đánh giá được (ngưỡng 2)`
        : null,
    coverage: {
      applicable: applicable.length,
      total: dimensions.length,
      value: applicable.length / dimensions.length,
    },
    confidence: confidenceWeight
      ? confidences.reduce((sum, dimension) => sum + (dimension.confidence ?? 0) * dimension.weight, 0) /
        confidenceWeight
      : null,
    contextLimited: meta.contextLimited,
    issueSnapshot: issueSnapshot(issues),
  };
}
