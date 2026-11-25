import { z } from 'zod';
import { SectionSchema } from './paper';

/** Passage index routes (docs/plans/PASSAGE_INDEX.md), shared by the worker and the app. */

export const PASSAGE_SEARCH_MAX_LIMIT = 50;
export const PASSAGE_QUERY_MAX_CHARS = 1000;
/** Paper ids one search or reindex request may name; a corpus may resolve to more. */
export const PASSAGE_MAX_PAPER_IDS = 1000;

export const PassageSectionRoleSchema = SectionSchema.shape.role;
export type PassageSectionRole = z.infer<typeof PassageSectionRoleSchema>;

const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^\P{Cc}+$/u);

export const PassageSearchRequestSchema = z.strictObject({
  query: z.string().trim().min(1).max(PASSAGE_QUERY_MAX_CHARS),
  corpusId: id.optional(),
  paperIds: z.array(id).min(1).max(PASSAGE_MAX_PAPER_IDS).optional(),
  sectionRoles: z.array(PassageSectionRoleSchema).min(1).max(11).optional(),
  limit: z.number().int().positive().max(PASSAGE_SEARCH_MAX_LIMIT).default(10),
});
export type PassageSearchRequest = z.input<typeof PassageSearchRequestSchema>;

export const PassageSourceSchema = z.enum(['vector', 'keyword']);

/** One retrieved paragraph. `paperId` + `paragraphId` is the citation anchor (`/papers/:paperId?p=:paragraphId`). */
export const PassageHitSchema = z.object({
  paperId: z.string(),
  paperTitle: z.string().nullable(),
  paragraphId: z.string(),
  sectionRole: z.string(),
  text: z.string(),
  /** Reciprocal-rank-fusion score; only the order matters. */
  score: z.number(),
  sources: z.array(PassageSourceSchema).min(1),
});
export type PassageHit = z.infer<typeof PassageHitSchema>;

export const PassageSearchResponseSchema = z.object({
  passages: z.array(PassageHitSchema),
  /** More passages matched than `limit` returned. */
  truncated: z.boolean(),
});
export type PassageSearchResponse = z.infer<typeof PassageSearchResponseSchema>;

export const PassageReindexRequestSchema = z.union([
  z.strictObject({ paperIds: z.array(id).min(1).max(PASSAGE_MAX_PAPER_IDS) }),
  z.strictObject({ corpusId: id }),
  z.strictObject({}),
]);
export type PassageReindexRequest = z.infer<typeof PassageReindexRequestSchema>;

export const PassageStatusSchema = z.object({
  queue: z.object({ pending: z.number(), done: z.number(), failed: z.number() }),
  passages: z.number(),
  papers: z.number(),
});
export type PassageStatus = z.infer<typeof PassageStatusSchema>;

export const PassageReindexResponseSchema = z.object({
  queued: z.number(),
  /** Papers indexed during the request; the cron indexes the rest within minutes. */
  processed: z.number(),
  status: PassageStatusSchema,
});
export type PassageReindexResponse = z.infer<typeof PassageReindexResponseSchema>;
