// SciAtlas (OpenKG) related-papers search: the request PaperLab sends to its worker, the payload the worker
// forwards to SciAtlas, and a defensive reader for SciAtlas's undocumented paper list. Shared by the worker
// (worker/src/sciatlas.ts) and the browser, so it imports only zod.
import { z } from 'zod';

export const SCIATLAS_LEVELS = ['high', 'middle', 'low'] as const;
export const SCIATLAS_MODES = ['keyword', 'semantic', 'title', 'hybrid'] as const;
export const SCIATLAS_RANKINGS = ['precision', 'balanced', 'discovery', 'impact'] as const;
export const SCIATLAS_MAX_TOP_K = 20;
export type SciAtlasLevel = (typeof SCIATLAS_LEVELS)[number];
export type SciAtlasRanking = (typeof SCIATLAS_RANKINGS)[number];

/** SciAtlas keyword scores (1–10) and title confidences (0–1), the base value of each level in its CLI. */
export const KEYWORD_SCORE: Record<SciAtlasLevel, number> = { high: 9, middle: 7, low: 4 };
export const TITLE_CONFIDENCE: Record<SciAtlasLevel, number> = { high: 0.95, middle: 0.85, low: 0.65 };

const level = z.enum(SCIATLAS_LEVELS);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

/** Body of `POST /v1/sciatlas/search` on the PaperLab worker. */
export const SciAtlasSearchRequestSchema = z
  .object({
    query: z.string().max(2000).default(''),
    keywords: z
      .array(z.object({ text: z.string().trim().min(1).max(200), level }))
      .max(20)
      .default([]),
    titles: z
      .array(z.object({ title: z.string().trim().min(1).max(500), level }))
      .max(10)
      .default([]),
    references: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
    after: day.optional(),
    before: day.optional(),
    topK: z.number().int().positive().default(10),
    mode: z.enum(SCIATLAS_MODES).default('hybrid'),
    ranking: z.enum(SCIATLAS_RANKINGS).optional(),
  })
  .refine((value) => value.keywords.length + value.titles.length > 0, {
    message: 'At least one keyword or title is required.',
    path: ['keywords'],
  });
export type SciAtlasSearchRequest = z.input<typeof SciAtlasSearchRequestSchema>;
/** A parsed request, with defaults applied; `/v1/kg/search` takes the same one. */
export type SciAtlasSearchInput = z.output<typeof SciAtlasSearchRequestSchema>;
type ParsedRequest = SciAtlasSearchInput;

/** The `{ plan, options }` body SciAtlas's `/v1/search` expects. */
export function toSciAtlasPayload(request: ParsedRequest) {
  const query =
    request.query.trim() ||
    [...request.titles.map(({ title }) => title), ...request.keywords.map(({ text }) => text)].join('; ');
  return {
    plan: {
      query_text: query,
      source_type: 'idea_text',
      source_title: request.titles[0]?.title ?? null,
      keywords: request.keywords.map(({ text, level }) => ({ text, score: KEYWORD_SCORE[level] })),
      titles: request.titles.map(({ title, level }) => ({ title, confidence: TITLE_CONFIDENCE[level] })),
      reference_titles: request.references,
    },
    options: {
      top_k: Math.min(request.topK, SCIATLAS_MAX_TOP_K),
      retrieval_mode: request.mode,
      ...(request.after ? { after: request.after } : {}),
      ...(request.before ? { before: request.before } : {}),
      ...(request.ranking ? { retrieval_bias: { ranking_profile: request.ranking } } : {}),
    },
  };
}

export const SciAtlasPaperSchema = z.object({
  rank: z.number().int().positive(),
  title: z.string(),
  year: z.number().int().nullable(),
  score: z.number().nullable(),
  citations: z.number().nullable(),
  venue: z.string().nullable(),
  authors: z.array(z.string()),
  id: z.string().nullable(),
  doi: z.string().optional(),
  openalexId: z.string().optional(),
  abstract: z.string().optional(),
});
export type SciAtlasPaper = z.infer<typeof SciAtlasPaperSchema>;
export const SciAtlasSearchResponseSchema = z.object({
  papers: z.array(SciAtlasPaperSchema),
  requestId: z.string().optional(),
  elapsedMs: z.number(),
});
export type SciAtlasSearchResponse = z.infer<typeof SciAtlasSearchResponseSchema>;

type Json = Record<string, unknown>;
const record = (value: unknown): Json | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : undefined;
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const numeric = (value: unknown) => {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
};
const first = <T>(item: Json, keys: readonly string[], read: (value: unknown) => T | undefined) => {
  for (const key of keys) {
    const value = read(item[key]);
    if (value !== undefined) return value;
  }
  return undefined;
};

const STRONG_TITLE = ['title', 'paper_title', 'work_title'] as const;
const WEAK_TITLE = ['display_name', 'name'] as const;
const YEAR = ['year', 'publication_year', 'pub_year'] as const;
const SCORE = ['score', 'rank_score', 'kg_score', 'similarity', 'similarity_score', 'final_score'] as const;
const CITATIONS = ['citation_count', 'cited_by_count', 'citations'] as const;
const VENUE = ['venue', 'journal', 'conference', 'source'] as const;
const ID = ['id', 'paper_id', 'openalex_id', 'doi', 'url'] as const;
const ABSTRACT = ['abstract', 'abstract_text'] as const;
/** Fields only a paper has; a bare `name` (an author, a keyword) is not taken as a paper without one. */
const PAPER_HINTS = [...YEAR, ...CITATIONS, 'doi', 'openalex_id', 'paper_id', 'authors', 'author_names'];
/** Parts of the envelope that echo the query, never results. */
const SKIPPED = new Set(['plan', 'query', 'keywords', 'titles', 'reference_titles', 'options']);

export function normalizeSciAtlasDoi(value: unknown) {
  const raw = text(value);
  const doi = raw
    ?.replace(/^https?:\/\/(dx\.)?doi\.org\//iu, '')
    .replace(/^doi:/iu, '')
    .toLowerCase();
  return doi && /^10\.\d{4,9}\/\S+$/u.test(doi) ? doi : undefined;
}
export function normalizeSciAtlasOpenAlexId(value: unknown) {
  const id = text(value)
    ?.replace(/^https?:\/\/openalex\.org\//iu, '')
    .toUpperCase();
  return id && /^W\d+$/u.test(id) ? id : undefined;
}

function titleOf(item: Json) {
  const strong = first(item, STRONG_TITLE, text);
  if (strong) return strong;
  const weak = first(item, WEAK_TITLE, text);
  return weak && PAPER_HINTS.some((key) => item[key] !== undefined && item[key] !== null) ? weak : undefined;
}

function authorsOf(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((author) => {
    const name =
      text(author) ?? (record(author) ? first(record(author) as Json, WEAK_TITLE, text) : undefined);
    return name ? [name] : [];
  });
}

function venueOf(item: Json) {
  for (const key of VENUE) {
    const value = item[key];
    const name = text(value) ?? (record(value) ? first(record(value) as Json, WEAK_TITLE, text) : undefined);
    if (name) return name;
  }
  return null;
}

function toPaper(item: Json, title: string): Omit<SciAtlasPaper, 'rank'> {
  const id = first(
    item,
    ID,
    (value) => text(value) ?? (numeric(value) !== undefined ? String(value) : undefined),
  );
  const doi = normalizeSciAtlasDoi(item.doi) ?? normalizeSciAtlasDoi(id);
  const openalexId =
    normalizeSciAtlasOpenAlexId(item.openalex_id) ??
    normalizeSciAtlasOpenAlexId(item.id) ??
    normalizeSciAtlasOpenAlexId(item.url);
  const year = first(item, YEAR, numeric);
  const abstract = first(item, ABSTRACT, text);
  return {
    title,
    year: year !== undefined && Number.isInteger(year) ? year : null,
    score: first(item, SCORE, numeric) ?? null,
    citations: first(item, CITATIONS, numeric) ?? null,
    venue: venueOf(item),
    authors: authorsOf(item.authors ?? item.author_names),
    id: id ?? null,
    ...(doi ? { doi } : {}),
    ...(openalexId ? { openalexId } : {}),
    ...(abstract ? { abstract: abstract.slice(0, 4000) } : {}),
  };
}

/**
 * Every object with a title found anywhere under `data`, in order, as the official CLI reads it. An object taken
 * as a paper is not searched further, so its authors and venue are never listed as papers of their own.
 */
export function normalizeSciAtlasPapers(data: unknown): SciAtlasPaper[] {
  const found: Omit<SciAtlasPaper, 'rank'>[] = [];
  const seen = new Set<string>();
  const walk = (value: unknown, depth: number) => {
    if (depth > 8) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const item = record(value);
    if (!item) return;
    const title = titleOf(item);
    if (title) {
      const paper = toPaper(item, title);
      const keys = [
        paper.doi && `doi:${paper.doi}`,
        paper.openalexId && `oa:${paper.openalexId}`,
        paper.id && `id:${paper.id}`,
        `title:${title.toLowerCase().replace(/\W+/gu, ' ').trim()}`,
      ].filter((key): key is string => Boolean(key));
      if (keys.some((key) => seen.has(key))) return;
      for (const key of keys) seen.add(key);
      found.push(paper);
      return;
    }
    for (const [key, child] of Object.entries(item)) if (!SKIPPED.has(key)) walk(child, depth + 1);
  };
  walk(data, 0);
  return found.map((paper, index) => ({ rank: index + 1, ...paper }));
}

/** SciAtlas's `{ status: "ok", ... }` envelope; another status is an error. Upstream text is never returned. */
export function readSciAtlasEnvelope(
  body: unknown,
): { ok: true; papers: SciAtlasPaper[]; requestId?: string } | { ok: false; requestId?: string } {
  const envelope = record(body);
  const id = text(envelope?.request_id);
  const requestId = id && /^[\w.:-]{1,100}$/u.test(id) ? id : undefined;
  const extra = requestId ? { requestId } : {};
  if (!envelope || envelope.status !== 'ok') return { ok: false, ...extra };
  return { ok: true, papers: normalizeSciAtlasPapers(envelope.data ?? envelope), ...extra };
}
