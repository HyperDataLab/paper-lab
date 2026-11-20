import { z } from 'zod';
import { runSchema } from '../autoresearch/record';
import { normalizeDoi } from '../library/doi';
import { bankDocSchema } from '../researchDesign/bank/snapshot';
import { AnalysisSchema } from '../schemas/analysis';
import { AuditEventSchema } from '../schemas/audit';
import { CalibrationLabelSetSchema } from '../schemas/calibration';
import { CorpusSchema } from '../schemas/corpus';
import { CorpusKeywordsSchema, DoiKeywordsSchema } from '../schemas/corpusKeywords';
import { StoredCorpusProfileSchema } from '../schemas/corpusProfile';
import { CorpusTopicsSchema, TopicNameSchema } from '../schemas/corpusTopics';
import { ExtractionProjectSchema } from '../schemas/extraction';
import { GenerationSchema } from '../schemas/generation';
import { GrobidRecordSchema } from '../schemas/grobid';
import { LibraryItemSchema } from '../schemas/library';
import { MeasurementsRecordSchema } from '../schemas/measurement';
import { PaperSchema } from '../schemas/paper';
import { PaperChecksRecordSchema } from '../schemas/paperChecks';
import { PaperContextRecordSchema } from '../schemas/paperContext';
import { PaperInsightsRecordSchema } from '../schemas/paperInsights';
import { PaperOverviewRecordSchema } from '../schemas/paperOverview';
import { PaperProbesRecordSchema } from '../schemas/paperProbe';
import { PaperReviewsRecordSchema, ReviewNgramSchema } from '../schemas/paperReview';
import { PaperRunSchema } from '../schemas/paperRun';
import { ResearchDesignSchema } from '../schemas/researchDesign';
import { RevisionSchema } from '../schemas/revision';
import { ScgPaperRunSchema } from '../schemas/scg';
import { StanceRecordSchema } from '../schemas/stance';

/**
 * The central lab store's collections (ADR-0007). Shared by the worker (server-side validation and the D1
 * index columns) and the app. Collection names are the former Dexie table names.
 */

/** Values projected from a body into the `doc` row's index columns. */
export interface DocIndex {
  projectId?: string | null;
  corpusId?: string | null;
  paperId?: string | null;
  /** The owning record for child collections, e.g. the analysis of an audit event. */
  refId?: string | null;
  doi?: string | null;
  title?: string | null;
  kind?: string | null;
  status?: string | null;
  sourceSha256?: string | null;
}
export const DOC_INDEX_FIELDS = [
  'projectId',
  'corpusId',
  'paperId',
  'refId',
  'doi',
  'title',
  'kind',
  'status',
  'sourceSha256',
] as const satisfies readonly (keyof DocIndex)[];
export type DocIndexField = (typeof DOC_INDEX_FIELDS)[number];

export interface CollectionDef<T = unknown> {
  schema: z.ZodType<T>;
  /** The record's id, which must equal the id in the request path. */
  key: (body: T) => string;
  index: (body: T) => DocIndex;
  /** Extra summary fields beyond the body's small top-level scalars. */
  summary?: (body: T) => Record<string, unknown>;
  /** `r2` keeps one immutable object per version; `inline` keeps small rows in D1. */
  storage: 'r2' | 'inline';
  maxBytes: number;
}

export const MIB = 1024 * 1024;
export const DEFAULT_MAX_BYTES = 10 * MIB;
export const INLINE_MAX_BYTES = 64 * 1024;
/** The summary JSON stored in D1 is capped; scalars that do not fit are dropped. */
export const SUMMARY_MAX_BYTES = 4096;

function define<S extends z.ZodType>(
  schema: S,
  options: {
    key: (body: z.output<S>) => string;
    index?: (body: z.output<S>) => DocIndex;
    summary?: (body: z.output<S>) => Record<string, unknown>;
    storage?: 'r2' | 'inline';
    maxBytes?: number;
  },
): CollectionDef {
  const storage = options.storage ?? 'r2';
  return {
    schema: schema as z.ZodType<unknown>,
    key: options.key as (body: unknown) => string,
    index: (options.index ?? (() => ({}))) as (body: unknown) => DocIndex,
    summary: options.summary as ((body: unknown) => Record<string, unknown>) | undefined,
    storage,
    maxBytes: options.maxBytes ?? (storage === 'inline' ? INLINE_MAX_BYTES : DEFAULT_MAX_BYTES),
  };
}

const byPaper = {
  key: (body: { paperId: string }) => body.paperId,
  index: (body: { paperId: string }) => ({ paperId: body.paperId }),
};

export const ResearchDesignBankSchema = z.object({
  projectId: z.uuid(),
  bank: bankDocSchema,
  bytes: z.array(z.number().int().min(0).max(255)),
});

export const COLLECTIONS = {
  analyses: define(AnalysisSchema, {
    key: (body) => body.id,
    index: (body) => ({ title: body.title ?? null, sourceSha256: body.text.sourceHash }),
  }),
  auditEvents: define(AuditEventSchema, {
    key: (body) => body.id,
    index: (body) => ({ refId: body.analysisId }),
    storage: 'inline',
  }),
  revisions: define(RevisionSchema, {
    key: (body) => body.id,
    index: (body) => ({ refId: body.sourceAnalysisId }),
  }),
  generations: define(GenerationSchema, { key: (body) => body.id }),
  papers: define(PaperSchema, {
    key: (body) => body.id,
    index: (body) => ({ title: body.title, kind: body.source.kind, sourceSha256: body.source.sha256 }),
  }),
  paperRuns: define(PaperRunSchema, {
    key: (body) => body.id,
    index: (body) => ({ paperId: body.paperId, status: body.status }),
  }),
  paperOverviews: define(PaperOverviewRecordSchema, byPaper),
  paperChecks: define(PaperChecksRecordSchema, byPaper),
  paperReviews: define(PaperReviewsRecordSchema, byPaper),
  paperProbes: define(PaperProbesRecordSchema, byPaper),
  measurements: define(MeasurementsRecordSchema, byPaper),
  stance: define(StanceRecordSchema, byPaper),
  paperContext: define(PaperContextRecordSchema, byPaper),
  paperInsights: define(PaperInsightsRecordSchema, byPaper),
  grobid: define(GrobidRecordSchema, {
    ...byPaper,
    index: (body) => ({ paperId: body.paperId, status: body.status, sourceSha256: body.sha256 }),
  }),
  scgRuns: define(ScgPaperRunSchema, {
    key: (body) => body.paperId,
    index: (body) => ({ paperId: body.paperId, doi: body.doi ? normalizeDoi(body.doi) : null }),
  }),
  library: define(LibraryItemSchema, {
    key: (body) => body.id,
    index: (body) => ({
      doi: normalizeDoi(body.doi),
      title: body.title,
      paperId: body.paper_id,
      status: body.lookup,
    }),
    storage: 'inline',
  }),
  corpora: define(CorpusSchema, {
    key: (body) => body.id,
    index: (body) => ({ title: body.title, kind: body.kind }),
    summary: (body) => ({ members: body.members.length }),
  }),
  corpusProfiles: define(StoredCorpusProfileSchema, {
    key: (body) => body.corpusId,
    index: (body) => ({ corpusId: body.corpusId }),
  }),
  corpusTopics: define(CorpusTopicsSchema, {
    key: (body) => body.snapshotId,
    summary: (body) => ({ corpusIds: body.corpora.map((corpus) => corpus.corpusId) }),
  }),
  topicNames: define(TopicNameSchema, {
    key: (body) => `${body.snapshotId}:${body.topicId}`,
    index: (body) => ({ refId: body.snapshotId }),
    storage: 'inline',
  }),
  corpusKeywords: define(CorpusKeywordsSchema, {
    key: (body) => body.corpusId,
    index: (body) => ({ corpusId: body.corpusId }),
  }),
  doiKeywords: define(DoiKeywordsSchema, {
    key: (body) => body.doi,
    index: (body) => ({ doi: normalizeDoi(body.doi) }),
  }),
  extractionProjects: define(ExtractionProjectSchema, {
    key: (body) => body.id,
    index: (body) => ({ title: body.title, paperId: body.paperId, corpusId: body.corpusId ?? null }),
    summary: (body) => ({
      papers: body.papers.length,
      fields: body.fields.length,
      visibleFields: body.fields.filter((field) => !field.hidden).length,
      verified: body.cells.filter((cell) => cell.status === 'VERIFIED').length,
    }),
  }),
  reviewNgrams: define(ReviewNgramSchema, {
    key: (body) => `${body.paperId}:${body.hash}`,
    index: (body) => ({ paperId: body.paperId }),
    storage: 'inline',
  }),
  calibrationLabels: define(CalibrationLabelSetSchema, {
    key: (body) => body.id,
    index: (body) => ({ title: body.sourceFileName }),
  }),
  researchDesigns: define(ResearchDesignSchema, {
    key: (body) => body.projectId,
    index: (body) => ({ projectId: body.projectId }),
  }),
  researchDesignBanks: define(ResearchDesignBankSchema, {
    key: (body) => body.projectId,
    index: (body) => ({ projectId: body.projectId }),
    // The bank zip is stored as a JSON number array, about four bytes per byte.
    maxBytes: 25 * MIB,
  }),
  autoresearchRuns: define(runSchema, {
    key: (body) => body.id,
    index: (body) => ({ projectId: body.projectId, status: body.status }),
  }),
} satisfies Record<string, CollectionDef>;

export type CollectionName = keyof typeof COLLECTIONS;
export const COLLECTION_NAMES = Object.keys(COLLECTIONS) as CollectionName[];
export const isCollectionName = (value: unknown): value is CollectionName =>
  typeof value === 'string' && Object.hasOwn(COLLECTIONS, value);

/** Small top-level scalars of the body (title, status, timestamps…) plus the collection's own extras. */
export function docSummary(def: CollectionDef, body: unknown): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  const add = (key: string, value: unknown) => {
    const next = { ...summary, [key]: value };
    if (new TextEncoder().encode(JSON.stringify(next)).byteLength <= SUMMARY_MAX_BYTES) summary[key] = value;
  };
  if (body && typeof body === 'object' && !Array.isArray(body))
    for (const [key, value] of Object.entries(body))
      if (
        value === null ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        (typeof value === 'string' && value.length <= 200)
      )
        add(key, value);
  for (const [key, value] of Object.entries(def.summary?.(body) ?? {})) add(key, value);
  return summary;
}
