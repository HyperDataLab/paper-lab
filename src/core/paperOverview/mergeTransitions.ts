import type { PaperOverviewRecord } from '../schemas';

type Transitions = NonNullable<PaperOverviewRecord['transitions']>;
export function mergeTransitions(
  previous: Transitions | null,
  result: Omit<Transitions, 'updatedAt'>,
  judgedAt: string,
): Transitions {
  const ids = new Set(result.pairs.map((pair) => pair.pairId));
  return {
    ...result,
    pairs: [...(previous?.pairs ?? []).filter((item) => !ids.has(item.pairId)), ...result.pairs],
    judgements: [
      ...(previous?.judgements ?? [])
        .filter((item) => !ids.has(item.pairId))
        .map((item) => ({ ...item, judgedAt: item.judgedAt ?? previous?.updatedAt })),
      ...result.judgements.map((item) => ({ ...item, judgedAt })),
    ],
    findings: [...(previous?.findings ?? []).filter((item) => !ids.has(item.pairId)), ...result.findings],
    updatedAt: judgedAt,
  };
}
