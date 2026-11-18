import type { ScgAlignmentOutput, ScgContribution, ScgPaperRun } from '../schemas';
import { prefilterScg } from './index';
import { SCG_LIMITS, scgChunk } from './pass';

const normDoi = (doi: string | null) => doi?.trim().toLowerCase() ?? null;
/**
 * Stage 3 candidates for each prerequisite: every contribution of a lab paper whose DOI the prerequisite
 * cites, then the lexical prefilter over the rest of the lab graph. The paper's own runs are excluded.
 */
export function scgAlignmentCandidates(run: ScgPaperRun, others: ScgPaperRun[]) {
  const pool = others.filter((o) => o.paperId !== run.paperId && o.idBase !== run.idBase);
  const all = pool.flatMap((o) => o.contributions.filter((c) => c.review !== 'rejected'));
  const byDoi = new Map<string, ScgContribution[]>();
  for (const o of pool) {
    const doi = normDoi(o.doi);
    if (doi)
      byDoi.set(doi, [...(byDoi.get(doi) ?? []), ...o.contributions.filter((c) => c.review !== 'rejected')]);
  }
  const result = new Map<string, ScgContribution[]>();
  for (const c of run.contributions)
    for (const p of c.prerequisites) {
      const cited = p.references.flatMap((r) =>
        r.kind === 'paper' ? (byDoi.get(normDoi(r.doi) ?? '') ?? []) : [],
      );
      const lexical = prefilterScg(p, all, { limit: 5, excludeIdBase: run.idBase });
      const unique = [...new Map([...cited, ...lexical].map((x) => [x.id, x])).values()];
      result.set(p.id, unique.slice(0, SCG_LIMITS.candidates));
    }
  return result;
}
export const scgAlignmentGroups = <T>(items: T[]) =>
  scgChunk(items, SCG_LIMITS.alignmentGroups, SCG_LIMITS.alignmentGroupSize);

/** Keeps matches whose prerequisite is in the group and whose contribution was offered for it. */
export function scgApplyMatches(
  contributions: ScgContribution[],
  offered: ReadonlyMap<string, ReadonlySet<string>>,
  output: ScgAlignmentOutput,
) {
  let dropped = 0;
  const found = new Map<string, ScgAlignmentOutput['matches']>();
  for (const match of output.matches) {
    if (!offered.get(match.prerequisiteId)?.has(match.contributionId)) {
      dropped++;
      continue;
    }
    found.set(match.prerequisiteId, [...(found.get(match.prerequisiteId) ?? []), match]);
  }
  const next = contributions.map((c) => ({
    ...c,
    prerequisites: c.prerequisites.map((p) => {
      const extra = found.get(p.id);
      if (!extra) return p;
      const matches = [...p.matches];
      for (const m of extra)
        if (!matches.some((x) => x.contributionId === m.contributionId))
          matches.push({
            contributionId: m.contributionId,
            matchType: m.matchType,
            explanation: m.explanation.trim(),
            review: 'candidate',
          });
      return { ...p, matches };
    }),
  }));
  return { contributions: next, dropped: { matches: dropped } };
}
