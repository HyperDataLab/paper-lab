import { z } from 'zod';

export const RetractedWorkSchema = z.object({
  doi: z.string(),
  title: z.string().nullable(),
  year: z.number().int().nullable(),
  /** True when the retracted work is the paper itself rather than something it cites. */
  isPaper: z.boolean(),
});
export const PaperMetadataSchema = z.object({
  source: z.enum(['manual', 'openalex', 'library']),
  fetchedAt: z.iso.datetime(),
  doi: z.string().nullable(),
  title: z.string().nullable(),
  type: z.string().nullable(),
  year: z.number().int().nullable(),
  authors: z.array(z.string()),
  // Added in R17a; defaults keep records saved before then valid.
  affiliations: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  venue: z.string().nullable(),
  volume: z.string().nullable(),
  issue: z.string().nullable(),
  pages: z.string().nullable(),
  citedBy: z.number().int().nonnegative().nullable(),
  topic: z.string().nullable(),
});
export type PaperMetadata = z.infer<typeof PaperMetadataSchema>;
export const PaperContextRecordSchema = z.object({
  schemaVersion: z.literal(1),
  paperId: z.uuid(),
  checkedAt: z.iso.datetime(),
  paperDoi: z.string().nullable(),
  /** DOIs sent to OpenAlex. */
  checked: z.number().int().nonnegative(),
  /** DOIs OpenAlex has a record for; the rest could not be assessed. */
  found: z.number().int().nonnegative(),
  retracted: z.array(RetractedWorkSchema),
  /** False when only the metadata has been looked up. */
  retractionChecked: z.boolean().default(true),
  metadata: PaperMetadataSchema.nullable().default(null),
});
export type RetractedWork = z.infer<typeof RetractedWorkSchema>;
export type PaperContextRecord = z.infer<typeof PaperContextRecordSchema>;
export type PaperContextRecordInput = z.input<typeof PaperContextRecordSchema>;
