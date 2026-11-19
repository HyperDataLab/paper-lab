import { z } from 'zod';
import { normalizeDoi } from '../library/doi';
import { openAlexShortId } from '../library/openAlexGraphMetadata';
import { SciAtlasSearchResponseSchema } from '../openkg/sciatlas';

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

/** `POST /v1/kg/search` answers in the `/v1/sciatlas/search` shape, plus a hint when the KG holds no paper. */
export const KgSearchResponseSchema = SciAtlasSearchResponseSchema.extend({
  hint: z.literal('kg_empty').optional(),
});
export type KgSearchResponse = z.infer<typeof KgSearchResponseSchema>;

export const KG_NODE_TABLES = [
  'paper',
  'keyword',
  'author',
  'institution',
  'source',
  'topic',
  'subfield',
  'field',
  'domain',
  'contribution',
] as const;
export const KG_EDGE_TABLES = [
  'has_keyword',
  'cites',
  'related_to',
  'authored',
  'affiliated',
  'coauthor',
  'cooccur',
  'has_topic',
  'subfield_of',
  'field_of',
  'domain_of',
  'builds_on',
] as const;

export const KgStatsSchema = z.object({
  nodes: z.record(z.enum(KG_NODE_TABLES), count),
  edges: z.record(z.enum(KG_EDGE_TABLES), count),
  queue: z.record(KgQueueStateSchema, count),
});
export type KgStats = z.infer<typeof KgStatsSchema>;

const ref = z.object({ id: z.string(), name: z.string().nullable() });
const linkedPaper = z.object({ id: z.string(), title: z.string(), year: z.number().int().nullable() });

export const KgPaperDetailSchema = z.object({
  paper: z.object({
    id: z.string(),
    doi: z.string().nullable(),
    title: z.string(),
    abstract: z.string().nullable(),
    year: z.number().int().nullable(),
    citations: z.number().int().nullable(),
    type: z.string().nullable(),
    venue: ref.nullable(),
  }),
  keywords: z.array(z.object({ id: z.string(), text: z.string(), score: z.number() })),
  topics: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable(),
      score: z.number().nullable(),
      subfield: ref.nullable(),
      field: ref.nullable(),
      domain: ref.nullable(),
    }),
  ),
  authors: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable(),
      orcid: z.string().nullable(),
      position: z.number().int().positive(),
      institutions: z.array(
        z.object({
          id: z.string(),
          name: z.string().nullable(),
          ror: z.string().nullable(),
          countryCode: z.string().nullable(),
        }),
      ),
    }),
  ),
  cites: z.array(linkedPaper),
  citedBy: z.array(linkedPaper),
  contributions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      review: z.enum(['candidate', 'accepted']),
    }),
  ),
});
export type KgPaperDetail = z.infer<typeof KgPaperDetailSchema>;

export const KgKeywordDetailSchema = z.object({
  keyword: z.object({ id: z.string(), text: z.string(), frequency: count }),
  cooccurring: z.array(
    z.object({ id: z.string(), text: z.string(), count: z.number().int().positive(), jaccard: z.number() }),
  ),
  papersPerYear: z.array(z.object({ year: z.number().int(), count: z.number().int().positive() })),
});
export type KgKeywordDetail = z.infer<typeof KgKeywordDetailSchema>;
