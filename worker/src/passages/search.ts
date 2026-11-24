// POST /v1/passages/search: hybrid passage retrieval inside one scope, a ResearchHub project or the lab (ADR-0009).
// Here `projectId` is the stored scope key: the project id, or 'lab'. Vectorize gives the passages nearest to the
// query embedding, D1 FTS5 gives BM25 keyword matches, and reciprocal rank fusion merges the two. Every hit is read
// back from D1 with `project_id = ?`, so a vector from another scope can never surface even if a metadata filter
// were missing. The query text is never logged.
import { ftsQuery } from '../../../src/core/labKg';
import type { PassageHit, PassageSearchRequestSchema } from '../../../src/core/schemas/passages';
import { chunk } from '../data/store';
import { EMBEDDING_MODEL, type D1Database } from '../kg/bindings';
import { isProjectPhysicalId, physicalId, scopePrefix } from '../scope';
import { scopeOfKey, type PassageEnv } from './bindings';
import type { z } from 'zod';

/** Reciprocal rank fusion constant (Cormack et al., 2009). */
export const RRF_K = 60;
export const VECTOR_TOP_K = 50;
export const KEYWORD_POOL = 100;
/**
 * Vectorize filters are at most 2 KB of JSON, about 40 UUIDs in a `paperId` `$in`. A longer paper list is split
 * over parallel queries; past `VECTOR_FILTER_IDS * MAX_VECTOR_QUERIES` papers the vector channel filters by project
 * only and D1 drops the passages of other papers.
 */
export const VECTOR_FILTER_IDS = 40;
export const MAX_VECTOR_QUERIES = 25;

type SearchInput = z.output<typeof PassageSearchRequestSchema>;
type Source = PassageHit['sources'][number];
type Key = string;

export class CorpusNotFoundError extends Error {}

const keyOf = (paperId: string, paragraphId: string): Key => JSON.stringify([paperId, paragraphId]);

/** RRF over ranked channels: score = Σ 1 / (k + rank), rank from 1. */
export function fuseRankings(channels: { source: Source; keys: Key[] }[], k = RRF_K) {
  const fused = new Map<Key, { score: number; sources: Source[] }>();
  for (const { source, keys } of channels)
    keys.forEach((key, index) => {
      const entry = fused.get(key) ?? { score: 0, sources: [] };
      entry.score += 1 / (k + index + 1);
      if (!entry.sources.includes(source)) entry.sources.push(source);
      fused.set(key, entry);
    });
  return [...fused.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
}

/**
 * The paper ids of a corpus's members, or null when the scope (`scope`: a project id or `LAB_PASSAGE_SCOPE`) has no
 * such corpus.
 */
export async function corpusPaperIds(
  env: Pick<PassageEnv, 'db' | 'bucket'>,
  scope: string,
  corpusId: string,
) {
  const hub = scopeOfKey(scope);
  // A lab caller cannot name a project row (ADR-0009).
  if (isProjectPhysicalId(corpusId)) return null;
  const [result] = await env.db.batch<{
    r2_key: string | null;
    body_json: string | null;
    deleted_at: string | null;
  }>([
    env.db
      .prepare(
        "SELECT r2_key, body_json, deleted_at FROM doc WHERE collection = 'corpora' AND id = ? AND hub_project_id IS ?",
      )
      .bind(physicalId(hub, corpusId), hub),
  ]);
  const row = result?.results[0];
  if (!row || row.deleted_at) return null;
  let text = row.body_json;
  if (text === null && row.r2_key) {
    const object = await env.bucket.get(row.r2_key);
    text = object ? await new Response(object.body).text() : null;
  }
  if (text === null) return null;
  const body = JSON.parse(text) as { members?: { identifiers?: { paperIds?: unknown } }[] };
  const ids = (body.members ?? []).flatMap(({ identifiers }) =>
    Array.isArray(identifiers?.paperIds)
      ? identifiers.paperIds.filter((id): id is string => typeof id === 'string')
      : [],
  );
  return [...new Set(ids)];
}

const json = (value: unknown[] | null) => (value ? JSON.stringify(value) : null);

async function vectorChannel(
  env: PassageEnv,
  query: string,
  projectId: string,
  paperIds: string[] | null,
  roles: string[] | null,
) {
  const values = (await env.ai.run(EMBEDDING_MODEL, { text: [query] })).data?.[0];
  if (values?.length !== 768 || values.some((value) => !Number.isFinite(value)))
    throw new Error('embedding_failed');
  const groups =
    paperIds && paperIds.length <= VECTOR_FILTER_IDS * MAX_VECTOR_QUERIES
      ? chunk(paperIds, VECTOR_FILTER_IDS)
      : [null];
  const results = await Promise.all(
    groups.map((group) =>
      env.vectors.query(values, {
        topK: VECTOR_TOP_K,
        returnMetadata: 'none',
        filter: group
          ? { projectId: { $eq: projectId }, paperId: { $in: group } }
          : { projectId: { $eq: projectId } },
      }),
    ),
  );
  const ranked = results
    .flatMap(({ matches }) => matches)
    .sort((a, b) => b.score - a.score)
    .slice(0, VECTOR_TOP_K)
    .map(({ id }) => id);
  if (!ranked.length) return [];
  const rows = await lookup(env.db, projectId, paperIds, roles, ranked);
  const byVector = new Map(rows.map((row) => [row.vector_id, keyOf(row.paper_id, row.paragraph_id)]));
  return ranked.flatMap((id) => byVector.get(id) ?? []);
}

async function lookup(
  db: D1Database,
  projectId: string,
  paperIds: string[] | null,
  roles: string[] | null,
  vectorIds: string[],
) {
  const [result] = await db.batch<{ paper_id: string; paragraph_id: string; vector_id: string }>([
    db
      .prepare(
        `SELECT paper_id, paragraph_id, vector_id FROM passage
        WHERE project_id = ?1 AND vector_id IN (SELECT value FROM json_each(?2))
          AND (?3 IS NULL OR paper_id IN (SELECT value FROM json_each(?3)))
          AND (?4 IS NULL OR section_role IN (SELECT value FROM json_each(?4)))`,
      )
      .bind(projectId, JSON.stringify(vectorIds), json(paperIds), json(roles)),
  ]);
  return result?.results ?? [];
}

async function keywordChannel(
  db: D1Database,
  query: string,
  projectId: string,
  paperIds: string[] | null,
  roles: string[] | null,
) {
  const match = ftsQuery([query]);
  if (!match) return [];
  const [result] = await db.batch<{ paper_id: string; paragraph_id: string }>([
    db
      .prepare(
        `SELECT p.paper_id, p.paragraph_id FROM passage_fts JOIN passage p ON p.rowid = passage_fts.rowid
        WHERE passage_fts MATCH ?1 AND p.project_id = ?2
          AND (?3 IS NULL OR p.paper_id IN (SELECT value FROM json_each(?3)))
          AND (?4 IS NULL OR p.section_role IN (SELECT value FROM json_each(?4)))
        ORDER BY bm25(passage_fts) LIMIT ${KEYWORD_POOL}`,
      )
      .bind(match, projectId, json(paperIds), json(roles)),
  ]);
  return (result?.results ?? []).map((row) => keyOf(row.paper_id, row.paragraph_id));
}

export async function searchPassages(env: PassageEnv, input: SearchInput, projectId: string) {
  let paperIds = input.paperIds ? [...new Set(input.paperIds)] : null;
  if (input.corpusId) {
    const members = await corpusPaperIds(env, projectId, input.corpusId);
    if (!members) throw new CorpusNotFoundError();
    const inCorpus = new Set(members);
    paperIds = paperIds ? paperIds.filter((id) => inCorpus.has(id)) : members;
  }
  if (paperIds && !paperIds.length) return { passages: [], truncated: false };
  const roles = input.sectionRoles ? [...new Set(input.sectionRoles)] : null;

  const [vector, keyword] = await Promise.all([
    // A failed embedding or vector query drops that channel; keyword matches still answer.
    vectorChannel(env, input.query, projectId, paperIds, roles).catch(() => [] as Key[]),
    keywordChannel(env.db, input.query, projectId, paperIds, roles),
  ]);
  const fused = fuseRankings([
    { source: 'vector', keys: vector },
    { source: 'keyword', keys: keyword },
  ]);
  const top = fused.slice(0, input.limit);
  if (!top.length) return { passages: [], truncated: false };

  const [result] = await env.db.batch<{
    paper_id: string;
    paragraph_id: string;
    section_role: string;
    text: string;
    title: string | null;
  }>([
    env.db
      .prepare(
        `SELECT p.paper_id, p.paragraph_id, p.section_role, p.text,
          coalesce(json_extract(d.summary_json, '$.detectedTitle'), d.title) AS title
        FROM json_each(?2) k
        JOIN passage p ON p.project_id = ?1 AND p.paper_id = json_extract(k.value, '$[0]')
          AND p.paragraph_id = json_extract(k.value, '$[1]')
        LEFT JOIN doc d ON d.collection = 'papers' AND d.id = ?3 || p.paper_id AND d.hub_project_id IS ?4`,
      )
      .bind(
        projectId,
        `[${top.map(({ key }) => key).join(',')}]`,
        scopePrefix(scopeOfKey(projectId)),
        scopeOfKey(projectId),
      ),
  ]);
  const rows = new Map((result?.results ?? []).map((row) => [keyOf(row.paper_id, row.paragraph_id), row]));
  const passages: PassageHit[] = top.flatMap(({ key, score, sources }) => {
    const row = rows.get(key);
    return row
      ? [
          {
            paperId: row.paper_id,
            paperTitle: row.title,
            paragraphId: row.paragraph_id,
            sectionRole: row.section_role,
            text: row.text,
            score: Number(score.toFixed(6)),
            sources,
          },
        ]
      : [];
  });
  return { passages, truncated: fused.length > input.limit };
}
