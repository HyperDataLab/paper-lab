// Product heuristics for UI triage. They need empirical calibration and are NOT thresholds stated by
// Schimel (PRD §4 "Examples of candidate rules requiring calibration"). They only produce labels; S5 never
// turns them into issues.
export const SV_GAP_REVIEW = 8;
export const SV_GAP_HIGH = 15;
export const CLAUSE_DEPTH_REVIEW = 3;

export type GapLabel = 'none' | 'review' | 'high';

export function classifyGap(distance: number | null): GapLabel | null {
  if (distance === null) return null;
  if (distance >= SV_GAP_HIGH) return 'high';
  if (distance >= SV_GAP_REVIEW) return 'review';
  return 'none';
}

export function isDeepClause(maxClauseDepth: number | null): boolean {
  return maxClauseDepth !== null && maxClauseDepth >= CLAUSE_DEPTH_REVIEW;
}
