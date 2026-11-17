import { z } from 'zod';

export const OaSourceSchema = z.object({
  source: z.enum(['openalex', 'unpaywall', 'europepmc']),
  landing_url: z.string().nullable(),
  pdf_url: z.string().nullable(),
  license: z.string().nullable(),
  version: z.string().nullable(),
});
export const TaxonomySchema = z.object({
  domain: z.string().nullable(),
  field: z.string().nullable(),
  subfield: z.string().nullable(),
  topic: z.string().nullable(),
  score: z.number().nullable(),
  /** OpenAlex short ids (`domains/<n>`, `fields/<n>`, `subfields/<n>`); absent on records saved before they were kept. */
  domainId: z.string().nullable().optional(),
  fieldId: z.string().nullable().optional(),
  subfieldId: z.string().nullable().optional(),
});
/** An OpenAlex keyword: `id` is the short form `keywords/<slug>`, `score` is OpenAlex's 0–1 relevance. */
export const PaperKeywordSchema = z.object({
  id: z.string().regex(/^keywords\/[a-z0-9][a-z0-9-]*$/u),
  name: z.string().min(1),
  score: z.number(),
});
export const LibraryItemSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  doi: z.string(),
  addedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lookup: z.enum(['pending', 'done', 'not_found', 'failed']),
  title: z.string().nullable(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  venue: z.string().nullable(),
  /** `none_found` means no source listed an open copy, not that the paper is paywalled. */
  access: z.enum(['open', 'none_found', 'unknown']),
  oa_sources: z.array(OaSourceSchema),
  arxiv_id: z.string().nullable(),
  taxonomy: TaxonomySchema.nullable(),
  openalex_id: z.string().nullable(),
  /**
   * OpenAlex keywords, highest score first (at most 20). Absent means never asked; `[]` means OpenAlex listed none,
   * so a backfill does not ask again.
   */
  keywords: z.array(PaperKeywordSchema).optional(),
  paper_id: z.uuid().nullable(),
  /** Whether the attached file seems to be this paper; null until a file is attached or when unknown. */
  file_matches_title: z.boolean().nullable(),
  error: z.string().nullable(),
});
export type OaSource = z.infer<typeof OaSourceSchema>;
export type Taxonomy = z.infer<typeof TaxonomySchema>;
export type PaperKeyword = z.infer<typeof PaperKeywordSchema>;
export type LibraryItem = z.infer<typeof LibraryItemSchema>;
