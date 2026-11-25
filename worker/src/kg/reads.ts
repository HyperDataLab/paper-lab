// Read routes over the lab KG: one paper with its neighbours, one keyword with co-occurrence and yearly counts,
// and graph-wide counts. Answers carry a weak ETag so a client can revalidate cheaply.
import {
  KG_EDGE_TABLES,
  KG_NODE_TABLES,
  kgIdentifier,
  type KgDetailEntityKind,
  type KgEntityDetail,
  type KgKeywordDetail,
  type KgOverview,
  type KgPaperDetail,
  type KgStats,
} from '../../../src/core/schemas/labKg';
import { publishedError } from '../published';
import type { D1Database } from './bindings';
import { kgQueue } from './queue';
import { logicalId, physicalId, scopeBind, scopedDb, type ProjectScope } from '../scope';

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

export async function readKgPaper(
  db: D1Database,
  key: string,
  projectId: ProjectScope,
): Promise<KgPaperDetail | null> {
  const isWork = /^W\d+$/u.test(key);
  db = scopedDb(db, projectId);
  const scopedKey = physicalId(projectId, key);
  const [found] = await db.batch<Row>([
    db
      .prepare(
        `SELECT p.id, p.doi, p.title, p.abstract, p.publication_year AS year, p.cited_by_count AS citations,
        p.type, p.source_id AS venueId, s.display_name AS venueName
      FROM paper p LEFT JOIN source s ON s.id = p.source_id
      WHERE p.id LIKE ? AND ${isWork ? 'p.id = ?' : 'p.doi = ?'} LIMIT 1`,
      )
      .bind(scopeBind(projectId), isWork ? scopedKey : key),
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
        `SELECT id, name, description, review FROM contribution WHERE paper_doi = ? AND published_paper_id LIKE ? ORDER BY published_paper_id, id`,
      )
      .bind(doi ?? '', scopeBind(projectId)),
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

export async function readKgKeyword(
  db: D1Database,
  id: string,
  projectId: ProjectScope,
): Promise<KgKeywordDetail | null> {
  db = scopedDb(db, projectId);
  const [found, cooccurring, perYear] = await db.batch<Row>([
    db
      .prepare('SELECT id, text, frequency FROM keyword WHERE id = ? AND id LIKE ?')
      .bind(id, scopeBind(projectId)),
    db
      .prepare(
        `SELECT k.id, k.text, c.count, c.jaccard FROM cooccur c
      JOIN keyword k ON k.id = CASE WHEN c.left_id = ?1 THEN c.right_id ELSE c.left_id END
      WHERE (c.left_id = ?1 OR c.right_id = ?1) AND k.id LIKE ?2
      ORDER BY c.jaccard DESC, c.count DESC, k.id LIMIT 30`,
      )
      .bind(id, scopeBind(projectId)),
    db
      .prepare(
        `SELECT p.publication_year AS year, count(*) AS count FROM has_keyword h JOIN paper p ON p.id = h.paper_id
      WHERE h.keyword_id = ?1 AND h.keyword_id LIKE ?2 AND p.publication_year IS NOT NULL
      GROUP BY p.publication_year ORDER BY year`,
      )
      .bind(id, scopeBind(projectId)),
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

const ENTITY_DETAILS: Record<
  KgDetailEntityKind,
  {
    table: string;
    paperJoin: string;
    relatedSql: string;
  }
> = {
  author: {
    table: 'author',
    paperJoin: 'JOIN authored rel ON rel.paper_id = p.id AND rel.author_id = ?1',
    relatedSql: `SELECT * FROM (
      SELECT au.id, au.display_name AS name, 'author' AS kind, co.count AS count
      FROM coauthor co JOIN author au ON au.id = CASE WHEN co.left_id = ?1 THEN co.right_id ELSE co.left_id END
      WHERE (co.left_id = ?1 OR co.right_id = ?1) AND EXISTS (
        SELECT 1 FROM authored a JOIN paper p ON p.id = a.paper_id
        WHERE a.author_id = ?1 AND p.id LIKE ?2
      ) AND au.id LIKE ?2
      UNION ALL
      SELECT i.id, i.display_name AS name, 'institution' AS kind, count(DISTINCT af.paper_id) AS count
      FROM affiliated af JOIN institution i ON i.id = af.institution_id JOIN paper p ON p.id = af.paper_id
      WHERE af.author_id = ?1 AND p.id LIKE ?2 AND i.id LIKE ?2 GROUP BY i.id
    ) ORDER BY count DESC, kind, id LIMIT 30`,
  },
  institution: {
    table: 'institution',
    paperJoin: 'JOIN affiliated rel ON rel.paper_id = p.id AND rel.institution_id = ?1',
    relatedSql: `SELECT au.id, au.display_name AS name, 'author' AS kind, count(DISTINCT af.paper_id) AS count
      FROM affiliated af JOIN author au ON au.id = af.author_id JOIN paper p ON p.id = af.paper_id
      WHERE af.institution_id = ?1 AND p.id LIKE ?2 AND au.id LIKE ?2 GROUP BY au.id ORDER BY count DESC, au.id LIMIT 30`,
  },
  topic: {
    table: 'topic',
    paperJoin: 'JOIN has_topic rel ON rel.paper_id = p.id AND rel.topic_id = ?1 AND rel.topic_id LIKE ?2',
    relatedSql: `SELECT sf.id, sf.display_name AS name, 'subfield' AS kind, NULL AS count
      FROM subfield_of so JOIN subfield sf ON sf.id = so.subfield_id
      WHERE so.topic_id = ?1 AND sf.id LIKE ?2 LIMIT 1`,
  },
  subfield: {
    table: 'subfield',
    paperJoin: `JOIN has_topic ht ON ht.paper_id = p.id AND ht.topic_id LIKE ?2
      JOIN subfield_of so ON so.topic_id = ht.topic_id AND so.subfield_id = ?1 AND so.topic_id LIKE ?2`,
    relatedSql: `SELECT f.id, f.display_name AS name, 'field' AS kind, NULL AS count
      FROM field_of fo JOIN field f ON f.id = fo.field_id WHERE fo.subfield_id = ?1 AND f.id LIKE ?2
      UNION ALL
      SELECT t.id, t.display_name AS name, 'topic' AS kind, count(DISTINCT ht.paper_id) AS count
      FROM subfield_of so JOIN topic t ON t.id = so.topic_id LEFT JOIN has_topic ht ON ht.topic_id = t.id
      WHERE so.subfield_id = ?1 AND t.id LIKE ?2 GROUP BY t.id ORDER BY kind, name LIMIT 31`,
  },
  field: {
    table: 'field',
    paperJoin: `JOIN has_topic ht ON ht.paper_id = p.id AND ht.topic_id LIKE ?2
      JOIN subfield_of so ON so.topic_id = ht.topic_id AND so.subfield_id LIKE ?2
      JOIN field_of fo ON fo.subfield_id = so.subfield_id AND fo.field_id = ?1 AND fo.field_id LIKE ?2`,
    relatedSql: `SELECT d.id, d.display_name AS name, 'domain' AS kind, NULL AS count
      FROM domain_of dof JOIN domain d ON d.id = dof.domain_id WHERE dof.field_id = ?1 AND d.id LIKE ?2
      UNION ALL
      SELECT sf.id, sf.display_name AS name, 'subfield' AS kind, count(DISTINCT ht.paper_id) AS count
      FROM field_of fo JOIN subfield sf ON sf.id = fo.subfield_id
      LEFT JOIN subfield_of so ON so.subfield_id = sf.id LEFT JOIN has_topic ht ON ht.topic_id = so.topic_id
      WHERE fo.field_id = ?1 AND sf.id LIKE ?2 GROUP BY sf.id ORDER BY kind, name LIMIT 31`,
  },
  domain: {
    table: 'domain',
    paperJoin: `JOIN has_topic ht ON ht.paper_id = p.id AND ht.topic_id LIKE ?2
      JOIN subfield_of so ON so.topic_id = ht.topic_id AND so.subfield_id LIKE ?2
      JOIN field_of fo ON fo.subfield_id = so.subfield_id AND fo.field_id LIKE ?2
      JOIN domain_of dof ON dof.field_id = fo.field_id AND dof.domain_id = ?1 AND dof.domain_id LIKE ?2`,
    relatedSql: `SELECT f.id, f.display_name AS name, 'field' AS kind, count(DISTINCT ht.paper_id) AS count
      FROM domain_of dof JOIN field f ON f.id = dof.field_id
      LEFT JOIN field_of fo ON fo.field_id = f.id LEFT JOIN subfield_of so ON so.subfield_id = fo.subfield_id
      LEFT JOIN has_topic ht ON ht.topic_id = so.topic_id
      WHERE dof.domain_id = ?1 AND f.id LIKE ?2 GROUP BY f.id ORDER BY count DESC, f.id LIMIT 30`,
  },
};

/** Reads a graph entity and its complete project-scoped counts plus capped useful neighbours. */
export async function readKgEntity(
  db: D1Database,
  kind: KgDetailEntityKind,
  id: string,
  projectId: ProjectScope,
): Promise<KgEntityDetail | null> {
  const spec = ENTITY_DETAILS[kind];
  db = scopedDb(db, projectId);
  const scopedId = physicalId(projectId, id);
  const projectPapers = scopeBind(projectId);
  const relatedStatement = db.prepare(spec.relatedSql).bind(scopedId, projectPapers);
  const [entityResult, countResult, paperResult, relatedResult] = await db.batch<Row>([
    db
      .prepare(
        `SELECT id, display_name AS name, ${kind === 'author' ? 'orcid' : 'NULL'} AS orcid,
      ${kind === 'institution' ? 'ror' : 'NULL'} AS ror,
      ${kind === 'institution' ? 'country_code' : 'NULL'} AS countryCode
      FROM ${spec.table} WHERE id = ?1 AND id LIKE ?2 LIMIT 1`,
      )
      .bind(scopedId, scopeBind(projectId)),
    db
      .prepare(`SELECT count(DISTINCT p.id) AS count FROM paper p ${spec.paperJoin} WHERE p.id LIKE ?2`)
      .bind(scopedId, projectPapers),
    db
      .prepare(
        `SELECT DISTINCT p.id, p.title, p.doi, p.publication_year AS year, p.cited_by_count AS citations
      FROM paper p ${spec.paperJoin} WHERE p.id LIKE ?2
      ORDER BY p.cited_by_count DESC, p.publication_year DESC, p.id LIMIT 25`,
      )
      .bind(scopedId, projectPapers),
    relatedStatement,
  ]);
  const entity = entityResult?.results[0];
  if (!entity) return null;
  return {
    kind,
    entity: {
      id: String(entity.id),
      name: str(entity.name),
      orcid: str(entity.orcid),
      ror: str(entity.ror),
      countryCode: str(entity.countryCode),
    },
    paperCount: Number(countResult?.results[0]?.count ?? 0),
    papers: (paperResult?.results ?? []).map((paper) => ({
      id: String(paper.id),
      title: String(paper.title),
      doi: str(paper.doi),
      year: num(paper.year),
      citations: num(paper.citations),
    })),
    related: (relatedResult?.results ?? []).map((row) => ({
      id: String(row.id),
      name: str(row.name),
      kind: String(row.kind) as KgDetailEntityKind,
      count: num(row.count),
    })),
  };
}

export async function readKgStats(db: D1Database, projectId: ProjectScope): Promise<KgStats> {
  // One row of scalar subqueries: D1 rejects a compound SELECT of more than five terms.
  const tables = [...KG_NODE_TABLES, ...KG_EDGE_TABLES];
  const scopeColumn: Record<string, string> = {
    paper: 'id',
    source: 'id',
    keyword: 'id',
    author: 'id',
    institution: 'id',
    topic: 'id',
    subfield: 'id',
    field: 'id',
    domain: 'id',
    contribution: 'published_paper_id',
    builds_on: 'published_paper_id',
    has_keyword: 'paper_id',
    cites: 'paper_id',
    related_to: 'paper_id',
    authored: 'paper_id',
    affiliated: 'paper_id',
    has_topic: 'paper_id',
    coauthor: 'left_id',
    cooccur: 'left_id',
    subfield_of: 'topic_id',
    field_of: 'subfield_id',
    domain_of: 'field_id',
  };
  db = scopedDb(db, projectId);
  const prefix = scopeBind(projectId);
  const sql = tables
    .map((table) => `(SELECT count(*) FROM ${table} WHERE ${scopeColumn[table]} LIKE ?) AS ${table}`)
    .join(', ');
  const [counts] = await db.batch<Record<string, number>>([
    db.prepare(`SELECT ${sql}`).bind(...tables.map(() => prefix)),
  ]);
  const row = counts?.results[0] ?? {};
  const pick = <T extends string>(names: readonly T[]) =>
    Object.fromEntries(names.map((name) => [name, Number(row[name] ?? 0)])) as Record<T, number>;
  const { counts: queue } = await kgQueue(db, projectId).status();
  return { nodes: pick(KG_NODE_TABLES), edges: pick(KG_EDGE_TABLES), queue };
}

const OVERVIEW_PAPERS = 8;
const OVERVIEW_KEYWORDS = 12;

/** Starting points for the explorer: the most cited papers and the most frequent keywords. */
export async function readKgOverview(db: D1Database, projectId: ProjectScope): Promise<KgOverview> {
  db = scopedDb(db, projectId);
  const prefix = scopeBind(projectId);
  const [papers, keywords] = await db.batch<Row>([
    db
      .prepare(
        `SELECT id, title, publication_year AS year, cited_by_count AS citations FROM paper
      WHERE id LIKE ? ORDER BY cited_by_count DESC, id LIMIT ?`,
      )
      .bind(prefix, OVERVIEW_PAPERS),
    db
      .prepare('SELECT id, text, frequency FROM keyword WHERE id LIKE ? ORDER BY frequency DESC, id LIMIT ?')
      .bind(prefix, OVERVIEW_KEYWORDS),
  ]);
  return {
    papers: (papers?.results ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      year: num(row.year),
      citations: num(row.citations),
    })),
    keywords: (keywords?.results ?? []).map((row) => ({
      id: String(row.id),
      text: String(row.text),
      frequency: Number(row.frequency),
    })),
  };
}

export async function handleKgRead(
  db: D1Database,
  request: Request,
  path: string,
  headers: Headers,
  projectId: ProjectScope,
) {
  if (request.method !== 'GET') return publishedError(405, 'bad_request', 'Use GET.', headers);
  const publicBody = (value: unknown) => stripProjectIds(value, projectId);
  if (path === '/v1/kg/stats') return withEtag(request, await readKgStats(db, projectId), headers);
  if (path === '/v1/kg/overview')
    return withEtag(request, publicBody(await readKgOverview(db, projectId)), headers);
  const paper = /^\/v1\/kg\/papers\/(.+)$/u.exec(path)?.[1];
  if (paper !== undefined) {
    let key: string | null | undefined;
    try {
      key = kgIdentifier(decodeURIComponent(paper));
    } catch {
      key = null;
    }
    if (!key) return publishedError(400, 'bad_request', 'Expected an OpenAlex work ID or a DOI.', headers);
    const detail = await readKgPaper(db, key, projectId);
    return detail
      ? withEtag(request, publicBody(detail), headers)
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
    const detail = await readKgKeyword(db, physicalId(projectId, id), projectId);
    return detail
      ? withEtag(request, publicBody(detail), headers)
      : publishedError(404, 'not_found', 'The keyword is not in the lab KG.', headers);
  }
  const entityPath = /^\/v1\/kg\/entities\/(author|institution|topic|subfield|field|domain)\/(.+)$/u.exec(
    path,
  );
  if (entityPath) {
    const kind = entityPath[1] as KgDetailEntityKind;
    let id: string;
    try {
      id = decodeURIComponent(entityPath[2] ?? '');
    } catch {
      return publishedError(400, 'bad_request', 'Malformed graph entity ID.', headers);
    }
    const identifier =
      kind === 'author'
        ? /^A\d+$/u.test(id)
        : kind === 'institution'
          ? /^I\d+$/u.test(id)
          : new RegExp(`^${kind === 'topic' ? 'topics' : `${kind}s`}\\/[A-Za-z0-9_-]+$`, 'u').test(id);
    if (!identifier) return publishedError(400, 'bad_request', 'Invalid graph entity ID.', headers);
    const detail = await readKgEntity(db, kind, id, projectId);
    return detail
      ? withEtag(request, publicBody(detail), headers)
      : publishedError(404, 'not_found', 'The graph entity is not in the lab KG.', headers);
  }
  return publishedError(400, 'bad_request', 'Invalid path or method.', headers);
}

function stripProjectIds(value: unknown, projectId: ProjectScope): unknown {
  if (typeof value === 'string') return logicalId(projectId, value);
  if (Array.isArray(value)) return value.map((item) => stripProjectIds(item, projectId));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, stripProjectIds(item, projectId)]),
  );
}
