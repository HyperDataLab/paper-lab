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

/** `GET /v1/kg/overview`: starting points for the explorer. */
export const KgOverviewSchema = z.object({
  papers: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      year: z.number().int().nullable(),
      citations: z.number().int().nullable(),
    }),
  ),
  keywords: z.array(z.object({ id: z.string(), text: z.string(), frequency: count })),
});
export type KgOverview = z.infer<typeof KgOverviewSchema>;

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

export const KG_DETAIL_ENTITY_KINDS = [
  'author',
  'institution',
  'topic',
  'subfield',
  'field',
  'domain',
] as const;
export type KgDetailEntityKind = (typeof KG_DETAIL_ENTITY_KINDS)[number];

/** Full, project-scoped profile for a non-paper/non-keyword graph node. */
export const KgEntityDetailSchema = z.object({
  kind: z.enum(KG_DETAIL_ENTITY_KINDS),
  entity: z.object({
    id: z.string(),
    name: z.string().nullable(),
    orcid: z.string().nullable(),
    ror: z.string().nullable(),
    countryCode: z.string().nullable(),
  }),
  paperCount: count,
  papers: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      doi: z.string().nullable(),
      year: z.number().int().nullable(),
      citations: z.number().int().nullable(),
    }),
  ),
  related: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable(),
      kind: z.enum(KG_DETAIL_ENTITY_KINDS),
      count: count.nullable(),
    }),
  ),
});
export type KgEntityDetail = z.infer<typeof KgEntityDetailSchema>;

/** `GET /v1/kg/graph` (L4): the neighbourhood of one KG node, ranked by weight and capped. */
export const KG_GRAPH_MAX_NODES = 150;
export const KG_GRAPH_DEFAULT_NODES = 80;
export const KG_GRAPH_LAYERS = ['papers', 'keywords', 'authors', 'institutions', 'topics'] as const;
export type KgGraphLayer = (typeof KG_GRAPH_LAYERS)[number];
export const KG_GRAPH_NODE_KINDS = [
  'paper',
  'keyword',
  'author',
  'institution',
  'topic',
  'subfield',
  'field',
  'domain',
] as const;
export type KgGraphNodeKind = (typeof KG_GRAPH_NODE_KINDS)[number];
export const KG_GRAPH_EDGE_TYPES = [
  'has_keyword',
  'cites',
  'cooccur',
  'authored',
  'affiliated',
  'coauthor',
  'has_topic',
  'hierarchy',
  'builds_on',
] as const;
export type KgGraphEdgeType = (typeof KG_GRAPH_EDGE_TYPES)[number];

export const KG_GRAPH_KIND_LAYER: Record<KgGraphNodeKind, KgGraphLayer> = {
  paper: 'papers',
  keyword: 'keywords',
  author: 'authors',
  institution: 'institutions',
  topic: 'topics',
  subfield: 'topics',
  field: 'topics',
  domain: 'topics',
};

const PREFIXED_KINDS = {
  keywords: 'keyword',
  topics: 'topic',
  subfields: 'subfield',
  fields: 'field',
  domains: 'domain',
} as const;

/** The node a graph centre names: an OpenAlex work (or DOI), author or institution ID, or a prefixed KG ID. */
export function kgGraphCentre(input: string): { id: string; kind: KgGraphNodeKind } | null {
  const value = input.trim();
  const prefix = /^(keywords|topics|subfields|fields|domains)\/\S+$/u.exec(value)?.[1];
  if (prefix) return { id: value, kind: PREFIXED_KINDS[prefix as keyof typeof PREFIXED_KINDS] };
  if (/^A\d+$/u.test(value)) return { id: value, kind: 'author' };
  if (/^I\d+$/u.test(value)) return { id: value, kind: 'institution' };
  const paper = kgIdentifier(value);
  return paper ? { id: paper, kind: 'paper' } : null;
}

export const KgGraphNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(KG_GRAPH_NODE_KINDS),
  label: z.string(),
  /** 1 for the centre; otherwise the strongest path weight, in [0, 1]. */
  weight: z.number().min(0).max(1),
  depth: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  year: z.number().int().nullable().optional(),
  doi: z.string().nullable().optional(),
  citations: z.number().int().nullable().optional(),
});
export type KgGraphNode = z.infer<typeof KgGraphNodeSchema>;

export const KgGraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.enum(KG_GRAPH_EDGE_TYPES),
  weight: z.number().min(0).max(1),
  review: z.enum(['candidate', 'accepted']).optional(),
});
export type KgGraphEdge = z.infer<typeof KgGraphEdgeSchema>;

export const KgGraphSchema = z.object({
  centre: z.string(),
  depth: z.union([z.literal(1), z.literal(2)]),
  layers: z.array(z.enum(KG_GRAPH_LAYERS)),
  nodes: z.array(KgGraphNodeSchema),
  edges: z.array(KgGraphEdgeSchema),
  /** True when more neighbours were found than the node limit allowed. */
  truncated: z.boolean(),
  /** Works the centre paper cites that are not in the KG yet (at most 50). */
  outside: z.array(z.string()),
});
export type KgGraph = z.infer<typeof KgGraphSchema>;

/** `GET /v1/kg/trend` (L4): papers per year for up to ten keywords. */
export const KG_TREND_LIMIT = 10;
export const KgTrendSchema = z.object({
  /** Every year from the first to the last with a counted paper. */
  years: z.array(z.number().int()),
  keywords: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      /** Papers carrying the keyword, including those with no year. */
      total: count,
      /** Papers per year, aligned with `years`. */
      counts: z.array(count),
    }),
  ),
  /** Requested keywords the KG does not hold. */
  missing: z.array(z.string()),
});
export type KgTrend = z.infer<typeof KgTrendSchema>;
