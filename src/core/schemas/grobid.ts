import { z } from 'zod';

/** The GROBID build and model the worker runs; a record with another tag is derived again. */
export const GROBID_VERSION = 'grobid-0.9.0-crf';

const PersonSchema = z.object({ forename: z.string(), surname: z.string() });
export const GrobidResultSchema = z.object({
  version: z.literal(GROBID_VERSION),
  header: z.object({
    title: z.string().nullable(),
    authors: z.array(PersonSchema),
    date: z.string().nullable(),
    arxivId: z.string().nullable(),
    doi: z.string().nullable(),
  }),
  references: z.array(
    z.object({
      id: z.string(),
      authors: z.array(PersonSchema),
      title: z.string().nullable(),
      venue: z.string().nullable(),
      year: z.number().int().nullable(),
      doi: z.string().nullable(),
      arxivId: z.string().nullable(),
      rawText: z.string().nullable(),
    }),
  ),
  /** One entry per link target; `referenceId` is null when GROBID could not resolve the marker. */
  citations: z.array(
    z.object({
      referenceId: z.string().nullable(),
      text: z.string(),
      sentence: z.string(),
      page: z.number().int().positive().nullable(),
    }),
  ),
});

/**
 * What GROBID gave for one paper, kept apart from the paper so the paper model and its export do not change.
 * Text and offsets in the result are GROBID's own; every location shown is anchored again in the PDF.js text.
 */
export const GrobidRecordSchema = z.object({
  schemaVersion: z.literal(1),
  paperId: z.uuid(),
  sha256: z.string(),
  version: z.literal(GROBID_VERSION),
  fetchedAt: z.iso.datetime(),
  status: z.enum(['ready', 'failed']),
  /** Vietnamese reason shown when `status` is `failed`. */
  error: z.string().nullable(),
  result: GrobidResultSchema.nullable(),
});
export type GrobidPerson = z.infer<typeof PersonSchema>;
export type GrobidResult = z.infer<typeof GrobidResultSchema>;
export type GrobidRecord = z.infer<typeof GrobidRecordSchema>;
