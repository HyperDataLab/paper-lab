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
  paper_id: z.uuid().nullable(),
  /** Whether the attached file seems to be this paper; null until a file is attached or when unknown. */
  file_matches_title: z.boolean().nullable(),
  error: z.string().nullable(),
});
export type OaSource = z.infer<typeof OaSourceSchema>;
export type Taxonomy = z.infer<typeof TaxonomySchema>;
export type LibraryItem = z.infer<typeof LibraryItemSchema>;
