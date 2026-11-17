import { z } from 'zod';
import { PaperKeywordSchema } from './library';

const count = z.number().int().nonnegative();
const share = z.number().min(0).max(1);
/** Counts keyed by publication year ("2021"); papers without a year are not in it. */
const byYear = z.record(z.string().regex(/^\d{4}$/u), count);

/** One corpus member and the OpenAlex keywords found for it, the input the collection was built from. */
export const KeywordPaperSchema = z.object({
  memberId: z.string(),
  year: z.number().int().nullable(),
  keywords: z.array(PaperKeywordSchema),
});
export const CorpusKeywordSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Member papers that carry this keyword. */
  paperCount: count,
  /** paperCount / papers with at least one keyword. */
  share,
  /** Mean OpenAlex score over the papers that carry it. */
  meanScore: z.number(),
  paperIds: z.array(z.string()),
  years: byYear,
});
export const KeywordPairSchema = z.object({
  a: z.string(),
  b: z.string(),
  /** Papers that carry both keywords. */
  count,
  /** Jaccard index: count / (papers with a + papers with b − count). */
  strength: share,
});
export const CorpusKeywordsSchema = z.object({
  schemaVersion: z.literal(1),
  corpusId: z.string(),
  computedAt: z.iso.datetime(),
  /** Members of the corpus when it was built, and a digest of their ids, to tell when it is out of date. */
  memberCount: count,
  memberDigest: z.string(),
  papersWithKeywords: count,
  papersByYear: byYear,
  papers: z.array(KeywordPaperSchema),
  keywords: z.array(CorpusKeywordSchema),
  pairs: z.array(KeywordPairSchema),
});
export type KeywordPaper = z.infer<typeof KeywordPaperSchema>;
export type CorpusKeyword = z.infer<typeof CorpusKeywordSchema>;
export type KeywordPair = z.infer<typeof KeywordPairSchema>;
export type CorpusKeywords = z.infer<typeof CorpusKeywordsSchema>;

/** Keywords fetched for a DOI that has no library record, so a corpus can use them without filling the library. */
export const DoiKeywordsSchema = z.object({
  doi: z.string(),
  fetchedAt: z.iso.datetime(),
  keywords: z.array(PaperKeywordSchema),
});
export type DoiKeywords = z.infer<typeof DoiKeywordsSchema>;
