import type { PaperModelSentence, ScgContribution, ScgPaperRun, ScgReview } from '../schemas';

/** The id prefix of a paper's contributions: its S2 corpus id when known, else the PaperLab paper id. */
export const scgIdBase = (paperId: string, s2CorpusId: string | null) => s2CorpusId ?? paperId;
/** `<idBase>.c<n>`, n counted from 0 as in SCG. */
export const scgContributionId = (idBase: string, index: number) => `${idBase}.c${index}`;
export const scgPrerequisiteId = (contributionId: string, index: number) => `${contributionId}.p${index}`;
/** The paper a contribution or prerequisite id belongs to. */
export const scgIdBaseOf = (id: string) => id.replace(/\.c\d+(?:\.p\d+)?$/u, '');

export type ScgEvidence = { sentenceKey: string; quote: string };
/**
 * Keeps the sentences whose quote is an exact non-empty substring of the sentence named, and counts the
 * rest. A caller drops an item whose `sourceSentenceKeys` comes back empty.
 */
export function anchorScgEvidence(
  evidence: ScgEvidence[],
  sentences: PaperModelSentence[] | ReadonlyMap<string, PaperModelSentence>,
) {
  const byKey = Array.isArray(sentences)
    ? new Map(sentences.map((sentence) => [sentence.key, sentence]))
    : sentences;
  const keys = new Set<string>();
  let dropped = 0;
  for (const item of evidence) {
    const quote = item.quote.trim();
    if (quote && byKey.get(item.sentenceKey)?.text.includes(quote)) keys.add(item.sentenceKey);
    else dropped++;
  }
  return { sourceSentenceKeys: [...keys], dropped };
}

/** Lower-case words of a name, used to merge duplicates and to carry reviews between runs. */
export const scgNameKey = (name: string) => (name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');

const STOPWORDS = new Set(
  (
    'a an and are as at based be by for from has in into is it its new of on or our that the their this to ' +
    'using via we with which approach method model paper propose proposed study work'
  ).split(' '),
);
export function scgTokens(text: string) {
  return new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
      (word) => word.length > 1 && !STOPWORDS.has(word),
    ),
  );
}

/**
 * Cheap lexical prefilter before any LLM call: contributions sharing content words with the prerequisite,
 * name words counting double. Rejected contributions and those of the paper `excludeIdBase` are skipped.
 */
export function prefilterScg(
  query: { name: string; description: string },
  contributions: ScgContribution[],
  options: { limit?: number; excludeIdBase?: string } = {},
) {
  const name = scgTokens(query.name);
  const all = scgTokens(`${query.name} ${query.description}`);
  return contributions
    .filter((item) => item.review !== 'rejected' && scgIdBaseOf(item.id) !== options.excludeIdBase)
    .map((contribution) => {
      let score = 0;
      for (const word of scgTokens(contribution.name)) if (name.has(word)) score += 2;
      for (const word of scgTokens(`${contribution.name} ${contribution.description}`))
        if (all.has(word)) score += 1;
      return { contribution, score };
    })
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score || a.contribution.id.localeCompare(b.contribution.id))
    .slice(0, options.limit ?? 5)
    .map((item) => item.contribution);
}

export type ScgReviewTarget = { contributionId: string; prerequisiteId?: string; matchId?: string };
/** Sets one review state: a contribution, a prerequisite of it, or a match of that prerequisite. */
export function setScgReview(run: ScgPaperRun, target: ScgReviewTarget, review: ScgReview): ScgPaperRun {
  return {
    ...run,
    contributions: run.contributions.map((contribution) => {
      if (contribution.id !== target.contributionId) return contribution;
      if (!target.prerequisiteId) return { ...contribution, review };
      return {
        ...contribution,
        prerequisites: contribution.prerequisites.map((prerequisite) => {
          if (prerequisite.id !== target.prerequisiteId) return prerequisite;
          if (!target.matchId) return { ...prerequisite, review };
          return {
            ...prerequisite,
            matches: prerequisite.matches.map((match) =>
              match.contributionId === target.matchId ? { ...match, review } : match,
            ),
          };
        }),
      };
    }),
  };
}

export const scgContributionCarryKey = (name: string) => `c:${scgNameKey(name)}`;
export const scgPrerequisiteCarryKey = (contributionName: string, name: string) =>
  `p:${scgNameKey(contributionName)}|${scgNameKey(name)}`;
/** Accepted and rejected items of a run by name, for `reviewCarry` of the next run. */
export function scgReviewCarry(run: ScgPaperRun | undefined): ScgPaperRun['reviewCarry'] {
  const carry: ScgPaperRun['reviewCarry'] = { ...run?.reviewCarry };
  for (const contribution of run?.contributions ?? []) {
    if (contribution.review !== 'candidate')
      carry[scgContributionCarryKey(contribution.name)] = contribution.review;
    for (const prerequisite of contribution.prerequisites)
      if (prerequisite.review !== 'candidate')
        carry[scgPrerequisiteCarryKey(contribution.name, prerequisite.name)] = prerequisite.review;
  }
  return carry;
}
