import { z } from 'zod';
import { normalizeDoi } from '../library/doi';
import { openAlexShortId } from '../library/openAlexGraphMetadata';

export const KG_INGEST_LIMIT = 50;
export const KG_DEFAULT_DEPTH = 1;
export const KG_CITED_BY_TOP_N = 10;

export const paperId = (input: string | null | undefined) => openAlexShortId(input?.toUpperCase(), /^W\d+$/u);

export const kgIdentifier = (input: string) => paperId(input) ?? normalizeDoi(input);

export const KgIngestSourceSchema = z.enum(['seed', 'expansion', 'sciatlas_pointer']);
export type KgIngestSource = z.infer<typeof KgIngestSourceSchema>;
export const KgIngestRequestSchema = z.strictObject({
  ids: z.array(z.string().max(2048).transform(kgIdentifier).pipe(z.string())).min(1).max(KG_INGEST_LIMIT),
  depth: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(KG_DEFAULT_DEPTH),
  source: KgIngestSourceSchema.default('seed'),
});

export const KgQueueStateSchema = z.enum(['pending', 'processing', 'done', 'failed']);
export type KgQueueState = z.infer<typeof KgQueueStateSchema>;
const count = z.number().int().nonnegative();
const jobError = z.object({ id: z.string(), code: z.string() });
export const KgIngestResultSchema = z.object({
  queued: count,
  processed: count,
  skipped: count,
  errors: z.array(jobError),
});
export type KgIngestResult = z.infer<typeof KgIngestResultSchema>;

export const KgIngestStatusSchema = z.object({
  counts: z.record(KgQueueStateSchema, count),
  logs: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      attempts: count,
      at: z.iso.datetime(),
    }),
  ),
});
export type KgIngestStatus = z.infer<typeof KgIngestStatusSchema>;
