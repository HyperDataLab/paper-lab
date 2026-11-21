import { KG_CITED_BY_TOP_N, paperId } from '../schemas/labKg';

/** Each input set represents one paper. Canonical pair order prevents double counting. */
function pairCounts(papers: Iterable<Iterable<string>>) {
  const frequency = new Map<string, number>();
  const counts = new Map<string, { left_id: string; right_id: string; count: number }>();
  for (const paper of papers) {
    const ids = [...new Set(paper)].sort();
    for (const [index, left] of ids.entries()) {
      frequency.set(left, (frequency.get(left) ?? 0) + 1);
      for (const right of ids.slice(index + 1)) {
        const key = JSON.stringify([left, right]);
        const existing = counts.get(key);
        if (existing) existing.count++;
        else counts.set(key, { left_id: left, right_id: right, count: 1 });
      }
    }
  }
  return { pairs: [...counts.values()], frequency };
}

export function cooccurUpdates(paperKeywords: Iterable<Iterable<string>>) {
  const { pairs, frequency } = pairCounts(paperKeywords);
  return pairs.map((pair) => ({
    ...pair,
    jaccard:
      pair.count / ((frequency.get(pair.left_id) ?? 0) + (frequency.get(pair.right_id) ?? 0) - pair.count),
  }));
}

export function coauthorUpdates(paperAuthors: Iterable<Iterable<string>>) {
  return pairCounts(paperAuthors).pairs;
}

export function expansionTargets(
  work: {
    id: string;
    referenced_works?: readonly (string | null)[];
    citing_works?: readonly (string | null)[];
  },
  { depth, citedByTopN = KG_CITED_BY_TOP_N }: { depth: number; citedByTopN?: number },
) {
  if (depth <= 0) return [];
  const ids = (works: readonly (string | null)[]) =>
    [...new Set(works.flatMap((value) => paperId(value) ?? []))].filter((id) => id !== paperId(work.id));
  return [
    ...new Set([
      ...ids(work.referenced_works ?? []),
      ...ids(work.citing_works ?? []).slice(0, Math.max(0, citedByTopN)),
    ]),
  ].map((id) => ({ id, depth: depth - 1 }));
}
