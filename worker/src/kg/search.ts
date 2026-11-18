// POST /v1/kg/search: hybrid related-paper search over the lab KG, in the /v1/sciatlas/search shape.
// D1 gives FTS5, keyword and title channels plus graph links; Vectorize gives similarity to the query
// embedding. Scoring lives in src/core/labKg/search.ts. The query text is never logged.
import {
  ftsPhrase,
  ftsQuery,
  keywordScore,
  normalizeBm25,
  normalizeText,
  rankKgCandidates,
  titleScore,
  yearRange,
  type KgCandidate,
  type KgSignals,
} from '../../../src/core/labKg';
import {
  SCIATLAS_MAX_TOP_K,
  SciAtlasSearchRequestSchema,
  type SciAtlasPaper,
  type SciAtlasSearchInput,
} from '../../../src/core/openkg/sciatlas';
import type { KgSearchResponse } from '../../../src/core/schemas/labKg';
import { publishedError } from '../published';
import { EMBEDDING_MODEL, type ConfiguredKg, type D1Statement, type SqlValue } from './bindings';

const MAX_BODY = 64 * 1024;
const POOL = 100;
const VECTOR_TOP_K = 50;
const ABSTRACT_LIMIT = 4000;

type PaperRow = {
  id: string;
  title: string;
  doi: string | null;
  abstract: string | null;
  year: number | null;
  citations: number | null;
  venue: string | null;
};

const years = (range: { from: number | null; to: number | null }): SqlValue[] => [range.from, range.to];
const YEAR_SQL = '(?2 IS NULL OR p.publication_year >= ?2) AND (?3 IS NULL OR p.publication_year <= ?3)';

async function readBody(request: Request) {
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY) return { tooLarge: true as const };
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY) return { tooLarge: true as const };
  try {
    return { body: JSON.parse(new TextDecoder().decode(raw)) as unknown };
  } catch {
    return { body: undefined };
  }
}

async function queryVector(kg: ConfiguredKg, text: string) {
  const values = (await kg.ai.run(EMBEDDING_MODEL, { text: [text] })).data?.[0];
  if (values?.length !== 768 || values.some((value) => !Number.isFinite(value)))
    throw new Error('embedding_failed');
  const { matches } = await kg.vectors.query(values, { topK: VECTOR_TOP_K });
  return new Map(matches.map(({ id, score }) => [id, Math.max(0, Math.min(1, score))]));
}

export async function searchKg(kg: ConfiguredKg, input: SciAtlasSearchInput, now: Date) {
  const { db } = kg;
  const mode = input.mode;
  const ranking = input.ranking ?? 'balanced';
  const range = yearRange(input.after, input.before);
  const text =
    input.query.trim() ||
    [...input.titles.map(({ title }) => title), ...input.keywords.map(({ text }) => text)].join('; ');
  const useText = mode === 'keyword' || mode === 'hybrid';
  const useTitle = mode === 'title' || mode === 'hybrid';
  const useVector = mode === 'semantic' || mode === 'hybrid';

  const [count] = await db.batch<{ n: number }>([db.prepare('SELECT count(*) AS n FROM paper')]);
  if (!count?.results[0]?.n) return { papers: [], hint: 'kg_empty' as const };

  // Vectorize runs alongside D1. In hybrid mode a failed embedding only drops that channel.
  const vectorPromise = useVector
    ? queryVector(kg, text).catch((error: unknown) => {
        if (mode === 'semantic') throw error;
        return new Map<string, number>();
      })
    : Promise.resolve(new Map<string, number>());

  // Phase 1: paper FTS, keyword resolution, title lookups and anchor papers.
  const statements: D1Statement[] = [];
  const slots: { kind: 'fts' | 'keyword' | 'title' | 'anchors' | 'references'; anchor?: number }[] = [];
  const fts = useText ? ftsQuery([text]) : null;
  if (fts) {
    statements.push(
      db
        .prepare(
          `SELECT p.id AS id, bm25(paper_fts) AS rank FROM paper_fts JOIN paper p ON p.rowid = paper_fts.rowid
        WHERE paper_fts MATCH ?1 AND ${YEAR_SQL} ORDER BY rank LIMIT ${POOL}`,
        )
        .bind(fts, ...years(range)),
    );
    slots.push({ kind: 'fts' });
  }
  input.keywords.forEach((keyword, anchor) => {
    const phrase = ftsPhrase(keyword.text);
    if (!phrase) return;
    statements.push(
      db
        .prepare(
          `SELECT k.id AS id FROM keyword k WHERE k.text_normalized = ?1
        UNION SELECT k.id FROM keyword_fts JOIN keyword k ON k.rowid = keyword_fts.rowid
        WHERE keyword_fts MATCH ?2 LIMIT 5`,
        )
        .bind(normalizeText(keyword.text), phrase),
    );
    slots.push({ kind: 'keyword', anchor });
  });
  if (useTitle)
    input.titles.forEach((title, anchor) => {
      const query = ftsQuery([title.title], 'title');
      if (!query) return;
      statements.push(
        db
          .prepare(
            `SELECT p.id AS id FROM paper_fts JOIN paper p ON p.rowid = paper_fts.rowid
          WHERE paper_fts MATCH ?1 AND ${YEAR_SQL} ORDER BY bm25(paper_fts) LIMIT 50`,
          )
          .bind(query, ...years(range)),
      );
      slots.push({ kind: 'title', anchor });
    });
  const anchorSql = 'SELECT id FROM paper WHERE title_normalized IN (SELECT value FROM json_each(?1))';
  statements.push(
    db.prepare(anchorSql).bind(JSON.stringify(input.titles.map(({ title }) => normalizeText(title)))),
  );
  slots.push({ kind: 'anchors' });
  statements.push(db.prepare(anchorSql).bind(JSON.stringify(input.references.map(normalizeText))));
  slots.push({ kind: 'references' });

  const phase1 = await db.batch<{ id: string; rank?: number }>(statements);
  const signals = new Map<string, KgSignals>();
  const signal = (id: string) => {
    let value = signals.get(id);
    if (!value) signals.set(id, (value = {}));
    return value;
  };
  const keywordAnchors = new Map<string, Set<number>>();
  const titleIds = new Set<string>();
  const anchorIds = new Set<string>();
  const referenceIds = new Set<string>();
  phase1.forEach(({ results }, index) => {
    const slot = slots[index];
    if (!slot) return;
    if (slot.kind === 'fts')
      for (const [id, score] of normalizeBm25(results.map(({ id, rank }) => ({ id, rank: rank ?? 0 }))))
        signal(id).fts = score;
    else if (slot.kind === 'keyword')
      for (const { id } of results) {
        const anchors = keywordAnchors.get(id) ?? new Set();
        anchors.add(slot.anchor ?? 0);
        keywordAnchors.set(id, anchors);
      }
    else if (slot.kind === 'title') for (const { id } of results) titleIds.add(id);
    else if (slot.kind === 'anchors') for (const { id } of results) anchorIds.add(id);
    else for (const { id } of results) referenceIds.add(id);
  });
  for (const id of titleIds) signal(id);

  // Phase 2: papers carrying the matched keywords, co-occurrence neighbours and citation links.
  const keywordIds = [...keywordAnchors.keys()];
  const highIds = keywordIds.filter((id) =>
    [...(keywordAnchors.get(id) ?? [])].some((anchor) => input.keywords[anchor]?.level === 'high'),
  );
  const seeds = highIds.length ? highIds : keywordIds;
  const linked = [...anchorIds, ...referenceIds];
  const [members, neighbours, cites] = await db.batch<{
    paperId: string;
    keywordId?: string;
    relevance?: number;
    jaccard?: number;
    links?: number;
  }>([
    db
      .prepare(
        `SELECT paper_id AS paperId, keyword_id AS keywordId, relevance_score AS relevance FROM has_keyword
      WHERE keyword_id IN (SELECT value FROM json_each(?1)) ORDER BY relevance_score DESC LIMIT 500`,
      )
      .bind(JSON.stringify(keywordIds)),
    db
      .prepare(
        `WITH seeds AS (SELECT value AS id FROM json_each(?1)),
      nb AS (
        SELECT CASE WHEN left_id IN (SELECT id FROM seeds) THEN right_id ELSE left_id END AS id, jaccard
        FROM cooccur WHERE left_id IN (SELECT id FROM seeds) OR right_id IN (SELECT id FROM seeds)
        ORDER BY jaccard DESC LIMIT 20
      )
      SELECT h.paper_id AS paperId, max(nb.jaccard) AS jaccard FROM nb JOIN has_keyword h ON h.keyword_id = nb.id
      WHERE nb.id NOT IN (SELECT id FROM seeds) GROUP BY h.paper_id ORDER BY jaccard DESC LIMIT ${POOL}`,
      )
      .bind(JSON.stringify(seeds)),
    db
      .prepare(
        `WITH anchors AS (SELECT value AS id FROM json_each(?1)),
      links AS (
        SELECT paper_id AS id FROM cites WHERE target_id IN (SELECT id FROM anchors)
        UNION ALL SELECT target_id FROM cites WHERE paper_id IN (SELECT id FROM anchors)
      )
      SELECT id AS paperId, count(*) AS links FROM links GROUP BY id ORDER BY links DESC LIMIT ${POOL}`,
      )
      .bind(JSON.stringify(linked)),
  ]);

  const matched = new Map<string, Map<number, number | null>>();
  for (const { paperId, keywordId, relevance } of members?.results ?? []) {
    const perAnchor = matched.get(paperId) ?? new Map<number, number | null>();
    for (const anchor of keywordAnchors.get(keywordId ?? '') ?? [])
      perAnchor.set(anchor, Math.max(perAnchor.get(anchor) ?? 0, relevance ?? 0));
    matched.set(paperId, perAnchor);
  }
  const highAnchors = input.keywords.filter(({ level }) => level === 'high').length;
  for (const [paperId, perAnchor] of matched) {
    const matches = [...perAnchor].flatMap(([anchor, relevance]) => {
      const keyword = input.keywords[anchor];
      return keyword ? [{ level: keyword.level, relevance }] : [];
    });
    const value = signal(paperId);
    if (useText) value.keyword = keywordScore(matches, input.keywords);
    if (highAnchors) value.sharedHigh = matches.filter(({ level }) => level === 'high').length / highAnchors;
  }
  for (const { paperId, jaccard } of neighbours?.results ?? [])
    signal(paperId).cooccur = Math.max(signal(paperId).cooccur ?? 0, jaccard ?? 0);
  for (const { paperId, links } of cites?.results ?? [])
    signal(paperId).citation = Math.min(1, (links ?? 0) / 2);

  for (const [id, score] of await vectorPromise) signal(id).vector = score;

  // Phase 3: paper rows for the candidates, filtered by year, then authors of the shown papers.
  const ids = [...signals.keys()];
  const [rows] = await db.batch<PaperRow>([
    db
      .prepare(
        `SELECT p.id, p.title, p.doi, p.abstract, p.publication_year AS year, p.cited_by_count AS citations,
        s.display_name AS venue FROM paper p LEFT JOIN source s ON s.id = p.source_id
      WHERE p.id IN (SELECT value FROM json_each(?1)) AND ${YEAR_SQL}`,
      )
      .bind(JSON.stringify(ids), ...years(range)),
  ]);
  const byId = new Map((rows?.results ?? []).map((row) => [row.id, row]));
  const candidates: KgCandidate[] = [...byId.values()].map((row) => {
    const value = signals.get(row.id) ?? {};
    if (useTitle && input.titles.length) value.title = titleScore(row.title, input.titles);
    return { id: row.id, year: row.year, citations: row.citations, signals: value };
  });
  const ranked = rankKgCandidates(candidates, {
    mode,
    ranking,
    currentYear: now.getUTCFullYear(),
    topK: Math.min(input.topK, SCIATLAS_MAX_TOP_K),
    years: range,
    // The paper a title anchor names is the one being searched from, so it is not its own related paper.
    exclude: anchorIds,
  });
  const shown = ranked.map(({ candidate }) => candidate.id);
  const [authorRows] = await db.batch<{ paperId: string; name: string | null }>([
    db
      .prepare(
        `SELECT a.paper_id AS paperId, au.display_name AS name FROM authored a JOIN author au ON au.id = a.author_id
      WHERE a.paper_id IN (SELECT value FROM json_each(?1)) ORDER BY a.paper_id, a.position`,
      )
      .bind(JSON.stringify(shown)),
  ]);
  const authors = new Map<string, string[]>();
  for (const { paperId, name } of authorRows?.results ?? [])
    if (name) authors.set(paperId, [...(authors.get(paperId) ?? []), name]);

  const papers: SciAtlasPaper[] = ranked.flatMap(({ candidate, score }, index) => {
    const row = byId.get(candidate.id);
    if (!row) return [];
    return [
      {
        rank: index + 1,
        title: row.title,
        year: row.year,
        score: Number(score.toFixed(4)),
        citations: row.citations,
        venue: row.venue,
        authors: authors.get(row.id) ?? [],
        id: row.id,
        ...(row.doi ? { doi: row.doi } : {}),
        openalexId: row.id,
        ...(row.abstract ? { abstract: row.abstract.slice(0, ABSTRACT_LIMIT) } : {}),
      },
    ];
  });
  return { papers };
}

/** The caller has checked the Firebase token and the KG bindings. */
export async function handleKgSearch(
  kg: ConfiguredKg,
  request: Request,
  headers: Record<string, string>,
  now: () => Date,
) {
  const reply = { ...headers, 'Cache-Control': 'no-store' };
  const fail = (status: number, error: string, message: string) =>
    publishedError(status, error, message, reply);
  const read = await readBody(request);
  if ('tooLarge' in read) return fail(413, 'bad_request', 'Request exceeds 64 KB.');
  if (read.body === undefined) return fail(400, 'bad_request', 'Body is not JSON.');
  const input = SciAtlasSearchRequestSchema.safeParse(read.body);
  // Only the failing field paths are echoed, never the query.
  if (!input.success)
    return fail(
      400,
      'bad_request',
      `Invalid search: ${[...new Set(input.error.issues.map((issue) => issue.path.join('.') || 'body'))].join(', ')}.`,
    );
  const start = Date.now();
  let result: Awaited<ReturnType<typeof searchKg>>;
  try {
    result = await searchKg(kg, input.data, now());
  } catch {
    return fail(502, 'kg_error', 'The lab KG search failed.');
  }
  const body: KgSearchResponse = { ...result, elapsedMs: Date.now() - start };
  return Response.json(body, { headers: reply });
}
