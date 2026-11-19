// Read routes over the lab KG: one paper with its neighbours, one keyword with co-occurrence and yearly counts,
// and graph-wide counts. Answers carry a weak ETag so a client can revalidate cheaply.
import {
  KG_EDGE_TABLES,
  KG_NODE_TABLES,
  kgIdentifier,
  type KgKeywordDetail,
  type KgPaperDetail,
  type KgStats,
} from '../../../src/core/schemas/labKg';
import { publishedError } from '../published';
import type { D1Database } from './bindings';
import { kgQueue } from './queue';

type Headers = Record<string, string>;

export async function withEtag(request: Request, body: unknown, headers: Headers) {
  const text = JSON.stringify(body);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = [...new Uint8Array(digest).slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0'));
  const etag = `W/"${hex.join('')}"`;
  const reply = { ...headers, ETag: etag, 'Cache-Control': 'private, no-cache' };
  if (request.headers.get('if-none-match') === etag)
    return new Response(null, { status: 304, headers: reply });
  return new Response(text, { status: 200, headers: { ...reply, 'Content-Type': 'application/json' } });
}

type Row = Record<string, string | number | null>;
const str = (value: unknown) => (typeof value === 'string' ? value : null);
const num = (value: unknown) => (typeof value === 'number' ? value : null);

export async function readKgPaper(db: D1Database, key: string): Promise<KgPaperDetail | null> {
  const isWork = /^W\d+$/u.test(key);
  const [found] = await db.batch<Row>([
    db
      .prepare(
        `SELECT p.id, p.doi, p.title, p.abstract, p.publication_year AS year, p.cited_by_count AS citations,
        p.type, p.source_id AS venueId, s.display_name AS venueName
      FROM paper p LEFT JOIN source s ON s.id = p.source_id WHERE ${isWork ? 'p.id' : 'p.doi'} = ? LIMIT 1`,
      )
      .bind(key),
  ]);
  const paper = found?.results[0];
  if (!paper) return null;
  const id = String(paper.id);
  const doi = str(paper.doi);
  const [keywords, topics, authors, affiliations, cites, citedBy, contributions] = await db.batch<Row>([
    db
      .prepare(
        `SELECT k.id, k.text, h.relevance_score AS score FROM has_keyword h JOIN keyword k ON k.id = h.keyword_id
      WHERE h.paper_id = ? ORDER BY h.relevance_score DESC, k.id`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT t.id, t.display_name AS name, ht.score,
        sf.id AS subfieldId, sf.display_name AS subfieldName,
        f.id AS fieldId, f.display_name AS fieldName,
        d.id AS domainId, d.display_name AS domainName
      FROM has_topic ht JOIN topic t ON t.id = ht.topic_id
      LEFT JOIN subfield_of so ON so.topic_id = t.id LEFT JOIN subfield sf ON sf.id = so.subfield_id
      LEFT JOIN field_of fo ON fo.subfield_id = sf.id LEFT JOIN field f ON f.id = fo.field_id
      LEFT JOIN domain_of dof ON dof.field_id = f.id LEFT JOIN domain d ON d.id = dof.domain_id
      WHERE ht.paper_id = ? ORDER BY ht.score DESC, t.id`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT au.id, au.display_name AS name, au.orcid, a.position FROM authored a
      JOIN author au ON au.id = a.author_id WHERE a.paper_id = ? ORDER BY a.position`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT af.author_id AS authorId, i.id, i.display_name AS name, i.ror, i.country_code AS countryCode
      FROM affiliated af JOIN institution i ON i.id = af.institution_id WHERE af.paper_id = ? ORDER BY i.id`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT p.id, p.title, p.publication_year AS year FROM cites c JOIN paper p ON p.id = c.target_id
      WHERE c.paper_id = ? ORDER BY p.publication_year DESC, p.id`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT p.id, p.title, p.publication_year AS year FROM cites c JOIN paper p ON p.id = c.paper_id
      WHERE c.target_id = ? ORDER BY p.publication_year DESC, p.id`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT id, name, description, review FROM contribution WHERE paper_doi = ? ORDER BY published_paper_id, id`,
      )
      .bind(doi ?? ''),
  ]);
  const linked = (rows: Row[] | undefined) =>
    (rows ?? []).map((row) => ({ id: String(row.id), title: String(row.title), year: num(row.year) }));
  const ref = (rowId: unknown, name: unknown) =>
    typeof rowId === 'string' ? { id: rowId, name: str(name) } : null;
  return {
    paper: {
      id,
      doi,
      title: String(paper.title),
      abstract: str(paper.abstract),
      year: num(paper.year),
      citations: num(paper.citations),
      type: str(paper.type),
      venue: ref(paper.venueId, paper.venueName),
    },
    keywords: (keywords?.results ?? []).map((row) => ({
      id: String(row.id),
      text: String(row.text),
      score: num(row.score) ?? 0,
    })),
    topics: (topics?.results ?? []).map((row) => ({
      id: String(row.id),
      name: str(row.name),
      score: num(row.score),
      subfield: ref(row.subfieldId, row.subfieldName),
      field: ref(row.fieldId, row.fieldName),
      domain: ref(row.domainId, row.domainName),
    })),
    authors: (authors?.results ?? []).map((row) => ({
      id: String(row.id),
      name: str(row.name),
      orcid: str(row.orcid),
      position: Number(row.position),
      institutions: (affiliations?.results ?? [])
        .filter(({ authorId }) => authorId === row.id)
        .map((inst) => ({
          id: String(inst.id),
          name: str(inst.name),
          ror: str(inst.ror),
          countryCode: str(inst.countryCode),
        })),
    })),
    cites: linked(cites?.results),
    citedBy: linked(citedBy?.results),
    contributions: (contributions?.results ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      review: row.review === 'accepted' ? 'accepted' : 'candidate',
    })),
  };
}

export async function readKgKeyword(db: D1Database, id: string): Promise<KgKeywordDetail | null> {
  const [found, cooccurring, perYear] = await db.batch<Row>([
    db.prepare('SELECT id, text, frequency FROM keyword WHERE id = ?').bind(id),
    db
      .prepare(
        `SELECT k.id, k.text, c.count, c.jaccard FROM cooccur c
      JOIN keyword k ON k.id = CASE WHEN c.left_id = ?1 THEN c.right_id ELSE c.left_id END
      WHERE c.left_id = ?1 OR c.right_id = ?1 ORDER BY c.jaccard DESC, c.count DESC, k.id LIMIT 30`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT p.publication_year AS year, count(*) AS count FROM has_keyword h JOIN paper p ON p.id = h.paper_id
      WHERE h.keyword_id = ? AND p.publication_year IS NOT NULL GROUP BY p.publication_year ORDER BY year`,
      )
      .bind(id),
  ]);
  const keyword = found?.results[0];
  if (!keyword) return null;
  return {
    keyword: { id: String(keyword.id), text: String(keyword.text), frequency: Number(keyword.frequency) },
    cooccurring: (cooccurring?.results ?? []).map((row) => ({
      id: String(row.id),
      text: String(row.text),
      count: Number(row.count),
      jaccard: Number(row.jaccard),
    })),
    papersPerYear: (perYear?.results ?? []).map((row) => ({
      year: Number(row.year),
      count: Number(row.count),
    })),
  };
}

export async function readKgStats(db: D1Database): Promise<KgStats> {
  const tables = [...KG_NODE_TABLES, ...KG_EDGE_TABLES];
  const [counts] = await db.batch<{ name: string; count: number }>([
    db.prepare(
      tables.map((table) => `SELECT '${table}' AS name, count(*) AS count FROM ${table}`).join(' UNION ALL '),
    ),
  ]);
  const byName = new Map((counts?.results ?? []).map(({ name, count }) => [name, count]));
  const pick = <T extends string>(names: readonly T[]) =>
    Object.fromEntries(names.map((name) => [name, byName.get(name) ?? 0])) as Record<T, number>;
  const { counts: queue } = await kgQueue(db).status();
  return { nodes: pick(KG_NODE_TABLES), edges: pick(KG_EDGE_TABLES), queue };
}

export async function handleKgRead(db: D1Database, request: Request, path: string, headers: Headers) {
  if (request.method !== 'GET') return publishedError(405, 'bad_request', 'Use GET.', headers);
  if (path === '/v1/kg/stats') return withEtag(request, await readKgStats(db), headers);
  const paper = /^\/v1\/kg\/papers\/(.+)$/u.exec(path)?.[1];
  if (paper !== undefined) {
    let key: string | null | undefined;
    try {
      key = kgIdentifier(decodeURIComponent(paper));
    } catch {
      key = null;
    }
    if (!key) return publishedError(400, 'bad_request', 'Expected an OpenAlex work ID or a DOI.', headers);
    const detail = await readKgPaper(db, key);
    return detail
      ? withEtag(request, detail, headers)
      : publishedError(404, 'not_found', 'The paper is not in the lab KG.', headers);
  }
  const keyword = /^\/v1\/kg\/keywords\/(.+)$/u.exec(path)?.[1];
  if (keyword !== undefined) {
    let id: string;
    try {
      id = decodeURIComponent(keyword);
    } catch {
      return publishedError(400, 'bad_request', 'Malformed keyword ID.', headers);
    }
    const detail = await readKgKeyword(db, id);
    return detail
      ? withEtag(request, detail, headers)
      : publishedError(404, 'not_found', 'The keyword is not in the lab KG.', headers);
  }
  return publishedError(400, 'bad_request', 'Invalid path or method.', headers);
}
