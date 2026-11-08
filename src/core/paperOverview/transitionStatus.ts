import type { Analysis, Paper, PaperOverviewRecord } from '../schemas';
import { transitionPairs } from './transitionPairs';

export function transitionStatus(
  paper: Paper,
  analyses: Analysis[],
  transitions: NonNullable<PaperOverviewRecord['transitions']>,
): NonNullable<PaperOverviewRecord['transitions']> {
  const current = new Map(transitionPairs(paper, analyses).map((pair) => [pair.pairId, pair]));
  const stored = new Map(transitions.pairs.map((pair) => [pair.pairId, pair]));
  const judgements = transitions.judgements.map((judgement) => {
    const before = stored.get(judgement.pairId);
    const after = current.get(judgement.pairId);
    const available = !!before && !!after;
    const changed = (side: 'from' | 'to') => {
      if (!before || !after) return true;
      const previous = before[side];
      const next = after[side];
      return (
        previous.analysisId !== next.analysisId ||
        (previous.analysisUpdatedAt
          ? previous.analysisUpdatedAt !== next.analysisUpdatedAt
          : !!next.analysisUpdatedAt &&
            next.analysisUpdatedAt > (judgement.judgedAt ?? transitions.updatedAt))
      );
    };
    return { ...judgement, available, stale: !available || changed('from') || changed('to') };
  });
  return { ...transitions, judgements, stale: judgements.some((item) => item.stale) };
}
