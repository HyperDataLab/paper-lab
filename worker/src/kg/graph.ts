// L4 read routes for the lab KG explorer: the neighbourhood of one node, and papers per year for a few keywords.
// Each hop is one D1 batch with a row limit per relation; ranking and caps live in src/core/labKg/graph.ts.
import {
  assembleKgGraph,
  kgEdgeWeight,
  kgFrontier,
  kgTrendTable,
  normalizeText,
  KG_GRAPH_OUTSIDE_LIMIT,
  KG_GRAPH_PER_RELATION,
  type KgLink,
  type KgNodeInfo,
} from '../../../src/core/labKg';
import {
  KG_GRAPH_DEFAULT_NODES,
  KG_GRAPH_LAYERS,
  KG_GRAPH_MAX_NODES,
  KG_TREND_LIMIT,
  kgGraphCentre,
  type KgGraph,
  type KgGraphLayer,
  type KgGraphNodeKind,
  type KgTrend,
} from '../../../src/core/schemas/labKg';
import { publishedError } from '../published';
import type { D1Database } from './bindings';
import { withEtag } from './reads';
import { logicalId, scopeBind, scopedDb, scopePrefix, scopeSqlLiteral, type ProjectScope } from '../scope';

type Headers = Record<string, string>;
type Row = Record<string, string | number | null>;
const str = (value: unknown) => (typeof value === 'string' ? value : null);
const num = (value: unknown) => (typeof value === 'number' ? value : null);

const PAPER = 'p.id, p.title, p.publication_year AS year, p.doi, p.cited_by_count AS citations';
const LIMIT = `LIMIT ${KG_GRAPH_PER_RELATION}`;

const paperNode = (row: Row): KgNodeInfo => ({
  id: String(row.id),
  kind: 'paper',
  label: String(row.title),
  year: num(row.year),
  doi: str(row.doi),
  citations: num(row.citations),
});
const named =
  (kind: KgGraphNodeKind) =>
  (row: Row): KgNodeInfo => ({ id: String(row.id), kind, label: str(row.name) ?? String(row.id) });

/** One relation of a node: a query bound to the node ID as `?1`, and how a row becomes a link. */
interface Relation {
  sql: string;
  link: (row: Row, id: string) => KgLink;
}

const toPaper = (row: Row, id: string, type: 'cites' | 'builds_on', outgoing: boolean, weight: number) => ({
  via: id,
  node: paperNode(row),
  edge: {
    source: outgoing ? id : String(row.id),
    target: outgoing ? String(row.id) : id,
    type,
    weight,
    ...(type === 'builds_on'
      ? { review: row.accepted ? ('accepted' as const) : ('candidate' as const) }
      : {}),
  },
});

const hierarchy = (kind: KgGraphNodeKind, child: boolean, weight: number) => (row: Row, id: string) => ({
  via: id,
  node: named(kind)(row),
  edge: {
    source: child ? String(row.id) : id,
    target: child ? id : String(row.id),
    type: 'hierarchy' as const,
    weight,
  },
});

const BUILDS_ON = `JOIN builds_on b ON b.published_paper_id = c.published_paper_id AND b.contribution_id = c.id`;

const RELATIONS: Record<KgGraphNodeKind, Relation[]> = {
  paper: [
    {
      sql: `SELECT k.id, k.text AS name, h.relevance_score AS score FROM has_keyword h
        JOIN keyword k ON k.id = h.keyword_id WHERE h.paper_id = ?1 ORDER BY h.relevance_score DESC, k.id ${LIMIT}`,
      link: (row, id) => ({
        via: id,
        node: named('keyword')(row),
        edge: {
          source: id,
          target: String(row.id),
          type: 'has_keyword',
          weight: kgEdgeWeight.score(num(row.score) ?? 0),
        },
      }),
    },
    {
      sql: `SELECT ${PAPER} FROM cites c JOIN paper p ON p.id = c.target_id WHERE c.paper_id = ?1
        ORDER BY p.cited_by_count DESC, p.id ${LIMIT}`,
      link: (row, id) => toPaper(row, id, 'cites', true, kgEdgeWeight.cites(num(row.citations))),
    },
    {
      sql: `SELECT ${PAPER} FROM cites c JOIN paper p ON p.id = c.paper_id WHERE c.target_id = ?1
        ORDER BY p.cited_by_count DESC, p.id ${LIMIT}`,
      link: (row, id) => toPaper(row, id, 'cites', false, kgEdgeWeight.cites(num(row.citations))),
    },
    {
      sql: `SELECT ${PAPER}, max(b.review = 'accepted') AS accepted FROM paper me
        JOIN contribution c ON c.paper_doi = me.doi ${BUILDS_ON}
        JOIN paper p ON p.doi = b.target_id
        WHERE me.id = ?1 AND c.published_paper_id LIKE '__PROJECT_PREFIX__' AND p.id LIKE '__PROJECT_PREFIX__'
          AND b.target_kind = 'paper' AND p.id <> me.id GROUP BY p.id ORDER BY p.id ${LIMIT}`,
      link: (row, id) => toPaper(row, id, 'builds_on', true, kgEdgeWeight.buildsOn),
    },
    {
      sql: `SELECT ${PAPER}, max(b.review = 'accepted') AS accepted FROM paper me
        JOIN builds_on b ON b.target_kind = 'paper' AND b.target_id = me.doi
        JOIN contribution c ON c.published_paper_id = b.published_paper_id AND c.id = b.contribution_id
        JOIN paper p ON p.doi = c.paper_doi
        WHERE me.id = ?1 AND c.published_paper_id LIKE '__PROJECT_PREFIX__' AND p.id LIKE '__PROJECT_PREFIX__'
          AND p.id <> me.id GROUP BY p.id ORDER BY p.id ${LIMIT}`,
      link: (row, id) => toPaper(row, id, 'builds_on', false, kgEdgeWeight.buildsOn),
    },
    {
      sql: `SELECT au.id, au.display_name AS name, a.position FROM authored a JOIN author au ON au.id = a.author_id
        WHERE a.paper_id = ?1 ORDER BY a.position, au.id ${LIMIT}`,
      link: (row, id) => ({
        via: id,
        node: named('author')(row),
        edge: {
          source: id,
          target: String(row.id),
          type: 'authored',
          weight: kgEdgeWeight.authored(Number(row.position)),
        },
      }),
    },
    {
      sql: `SELECT i.id, i.display_name AS name, af.author_id AS authorId FROM affiliated af
        JOIN institution i ON i.id = af.institution_id WHERE af.paper_id = ?1 ORDER BY i.id, af.author_id ${LIMIT}`,
      link: (row, id) => ({
        via: id,
        node: named('institution')(row),
        edge: {
          source: String(row.authorId),
          target: String(row.id),
          type: 'affiliated',
          weight: kgEdgeWeight.affiliated,
        },
      }),
    },
    {
      sql: `SELECT t.id, t.display_name AS name, ht.score FROM has_topic ht JOIN topic t ON t.id = ht.topic_id
        WHERE ht.paper_id = ?1 ORDER BY ht.score DESC, t.id ${LIMIT}`,
      link: (row, id) => ({
        via: id,
        node: named('topic')(row),
        edge: {
          source: id,
          target: String(row.id),
          type: 'has_topic',
          weight: kgEdgeWeight.topic(num(row.score)),
        },
      }),
    },
  ],
  keyword: [
    {
      sql: `SELECT ${PAPER}, h.relevance_score AS score FROM has_keyword h JOIN paper p ON p.id = h.paper_id
        WHERE h.keyword_id = ?1 ORDER BY h.relevance_score DESC, p.cited_by_count DESC, p.id ${LIMIT}`,
      link: (row, id) => ({
        via: id,
        node: paperNode(row),
        edge: {
          source: String(row.id),
          target: id,
          type: 'has_keyword',
          weight: kgEdgeWeight.score(num(row.score) ?? 0),
        },
      }),
    },
    {
      sql: `SELECT k.id, k.text AS name, c.jaccard FROM cooccur c
        JOIN keyword k ON k.id = CASE WHEN c.left_id = ?1 THEN c.right_id ELSE c.left_id END
        WHERE c.left_id = ?1 OR c.right_id = ?1 ORDER BY c.jaccard DESC, c.count DESC, k.id ${LIMIT}`,
      link: (row, id) => ({
        via: id,
        node: named('keyword')(row),
        edge: {
          source: id,
          target: String(row.id),
          type: 'cooccur',
          weight: kgEdgeWeight.score(Number(row.jaccard)),
        },
      }),
    },
  ],
  author: [
    {
      sql: `SELECT ${PAPER}, a.position FROM authored a JOIN paper p ON p.id = a.paper_id WHERE a.author_id = ?1
        ORDER BY p.cited_by_count DESC, p.id ${LIMIT}`,
      link: (row, id) => ({
        via: id,
        node: paperNode(row),
        edge: {
          source: String(row.id),
          target: id,
          type: 'authored',
          weight: kgEdgeWeight.authored(Number(row.position)),
        },
      }),
    },
    {
      sql: `SELECT au.id, au.display_name AS name, c.count FROM coauthor c
        JOIN author au ON au.id = CASE WHEN c.left_id = ?1 THEN c.right_id ELSE c.left_id END
        WHERE c.left_id = ?1 OR c.right_id = ?1 ORDER BY c.count DESC, au.id ${LIMIT}`,
      link: (row, id) => ({
        via: id,
        node: named('author')(row),
        edge: {
          source: id,
          target: String(row.id),
          type: 'coauthor',
          weight: kgEdgeWeight.coauthor(Number(row.count)),
        },
      }),
    },
    {
      sql: `SELECT i.id, i.display_name AS name, count(*) AS papers FROM affiliated af
        JOIN institution i ON i.id = af.institution_id WHERE af.author_id = ?1 GROUP BY i.id
        ORDER BY papers DESC, i.id ${LIMIT}`,
      link: (row, id) => ({
        via: id,
        node: named('institution')(row),
        edge: { source: id, target: String(row.id), type: 'affiliated', weight: kgEdgeWeight.affiliated },
      }),
    },
  ],
  institution: [
    {
      sql: `SELECT au.id, au.display_name AS name, count(*) AS papers FROM affiliated af
        JOIN author au ON au.id = af.author_id WHERE af.institution_id = ?1 GROUP BY au.id
        ORDER BY papers DESC, au.id ${LIMIT}`,
      link: (row, id) => ({
        via: id,
        node: named('author')(row),
        edge: { source: String(row.id), target: id, type: 'affiliated', weight: kgEdgeWeight.affiliated },
      }),
    },
  ],
  topic: [
    {
      sql: `SELECT ${PAPER}, ht.score FROM has_topic ht JOIN paper p ON p.id = ht.paper_id WHERE ht.topic_id = ?1
        ORDER BY ht.score DESC, p.cited_by_count DESC, p.id ${LIMIT}`,
      link: (row, id) => ({
        via: id,
        node: paperNode(row),
        edge: {
          source: String(row.id),
          target: id,
          type: 'has_topic',
          weight: kgEdgeWeight.topic(num(row.score)),
        },
      }),
    },
    {
      sql: `SELECT s.id, s.display_name AS name FROM subfield_of so JOIN subfield s ON s.id = so.subfield_id
        WHERE so.topic_id = ?1`,
      link: hierarchy('subfield', false, kgEdgeWeight.hierarchy),
    },
  ],
  subfield: [
    {
      sql: `SELECT f.id, f.display_name AS name FROM field_of fo JOIN field f ON f.id = fo.field_id
        WHERE fo.subfield_id = ?1`,
      link: hierarchy('field', false, kgEdgeWeight.hierarchy),
    },
    {
      sql: `SELECT t.id, t.display_name AS name FROM subfield_of so JOIN topic t ON t.id = so.topic_id
        WHERE so.subfield_id = ?1 ORDER BY t.id ${LIMIT}`,
      link: hierarchy('topic', true, kgEdgeWeight.hierarchy),
    },
  ],
  field: [
    {
      sql: `SELECT d.id, d.display_name AS name FROM domain_of dof JOIN domain d ON d.id = dof.domain_id
        WHERE dof.field_id = ?1`,
      link: hierarchy('domain', false, kgEdgeWeight.hierarchy),
    },
    {
      sql: `SELECT s.id, s.display_name AS name FROM field_of fo JOIN subfield s ON s.id = fo.subfield_id
        WHERE fo.field_id = ?1 ORDER BY s.id ${LIMIT}`,
      link: hierarchy('subfield', true, kgEdgeWeight.hierarchy),
    },
  ],
  domain: [
    {
      sql: `SELECT f.id, f.display_name AS name FROM domain_of dof JOIN field f ON f.id = dof.field_id
        WHERE dof.domain_id = ?1 ORDER BY f.id ${LIMIT}`,
      link: hierarchy('field', true, kgEdgeWeight.hierarchy),
    },
  ],
};

const CENTRE_SQL: Record<KgGraphNodeKind, string> = {
  paper: `SELECT ${PAPER} FROM paper p WHERE (p.id = ?1 OR p.doi = ?1) AND p.id LIKE ?2 ORDER BY p.id LIMIT 1`,
  keyword: 'SELECT id, text AS name FROM keyword WHERE id = ?1',
  author: 'SELECT id, display_name AS name FROM author WHERE id = ?1',
  institution: 'SELECT id, display_name AS name FROM institution WHERE id = ?1',
  topic: 'SELECT id, display_name AS name FROM topic WHERE id = ?1',
  subfield: 'SELECT id, display_name AS name FROM subfield WHERE id = ?1',
  field: 'SELECT id, display_name AS name FROM field WHERE id = ?1',
  domain: 'SELECT id, display_name AS name FROM domain WHERE id = ?1',
};

async function expand(db: D1Database, from: Pick<KgNodeInfo, 'id' | 'kind'>[], projectId: ProjectScope) {
  const plan = from.flatMap(({ id, kind }) => RELATIONS[kind].map((relation) => ({ id, relation })));
  if (!plan.length) return [];
  const results = await db.batch<Row>(
    plan.map(({ id, relation }) =>
      db
        .prepare(
          relation.sql.replace(/([\w.]+) LIKE '__PROJECT_PREFIX__'/gu, (_match, column: string) =>
            scopeSqlLiteral(projectId, column),
          ),
        )
        .bind(id),
    ),
  );
  return plan.flatMap(({ id, relation }, index) =>
    (results[index]?.results ?? []).map((row) => relation.link(row, id)),
  );
}

export async function readKgGraph(
  db: D1Database,
  options: { centre: string; kind: KgGraphNodeKind; depth: 1 | 2; layers: KgGraphLayer[]; limit: number },
  projectId: ProjectScope,
): Promise<KgGraph | null> {
  db = scopedDb(db, projectId);
  const prefix = scopePrefix(projectId);
  const scopedCentre = options.centre.startsWith('10.') ? options.centre : `${prefix}${options.centre}`;
  const centreStatement =
    options.kind === 'paper'
      ? db.prepare(CENTRE_SQL[options.kind]).bind(scopedCentre, scopeBind(projectId))
      : db.prepare(CENTRE_SQL[options.kind]).bind(scopedCentre);
  const [found] = await db.batch<Row>([centreStatement]);
  const row = found?.results[0];
  if (!row) return null;
  const centre = options.kind === 'paper' ? paperNode(row) : named(options.kind)(row);
  const layers = new Set(options.layers);
  const first = await expand(db, [centre], projectId);
  const hops = [first];
  if (options.depth === 2) {
    const reached = assembleKgGraph({ centre, hops, layers, limit: Number.MAX_SAFE_INTEGER });
    hops.push(await expand(db, kgFrontier(reached.nodes), projectId));
  }
  const graph = assembleKgGraph({ centre, hops, layers, limit: options.limit });
  let outside: string[] = [];
  if (centre.kind === 'paper') {
    const [missing] = await db.batch<Row>([
      db
        .prepare(
          `SELECT c.target_id AS id FROM cites c LEFT JOIN paper p ON p.id = c.target_id
          WHERE c.paper_id = ?1 AND p.id IS NULL ORDER BY c.target_id LIMIT ${KG_GRAPH_OUTSIDE_LIMIT}`,
        )
        .bind(centre.id),
    ]);
    outside = (missing?.results ?? []).map(({ id }) => {
      return logicalId(projectId, String(id));
    });
  }
  return { centre: centre.id, depth: options.depth, layers: options.layers, ...graph, outside };
}

export async function readKgTrend(
  db: D1Database,
  requested: string[],
  projectId: ProjectScope,
): Promise<KgTrend> {
  db = scopedDb(db, projectId);
  const prefix = scopePrefix(projectId);
  const ids = requested.filter((value) => value.startsWith('keywords/')).map((value) => `${prefix}${value}`);
  const texts = requested.filter((value) => !value.startsWith('keywords/')).map(normalizeText);
  const [found] = await db.batch<Row>([
    db
      .prepare(
        `SELECT id, text, text_normalized AS normalized, frequency FROM keyword
        WHERE (id IN (SELECT value FROM json_each(?1)) OR text_normalized IN (SELECT value FROM json_each(?2)))
          AND id LIKE ?3
        ORDER BY id`,
      )
      .bind(JSON.stringify(ids), JSON.stringify(texts), scopeBind(projectId)),
  ]);
  const rows = found?.results ?? [];
  const keywords = new Map<string, { id: string; text: string; total: number }>();
  const missing: string[] = [];
  for (const value of requested) {
    const match = value.startsWith('keywords/')
      ? rows.find(({ id }) => id === `${prefix}${value}`)
      : rows.find(({ normalized }) => normalized === normalizeText(value));
    if (!match) missing.push(value);
    else if (!keywords.has(String(match.id)))
      keywords.set(String(match.id), {
        id: String(match.id),
        text: String(match.text),
        total: Number(match.frequency),
      });
  }
  if (!keywords.size) return { years: [], keywords: [], missing };
  const [perYear] = await db.batch<{ keywordId: string; year: number; count: number }>([
    db
      .prepare(
        `SELECT h.keyword_id AS keywordId, p.publication_year AS year, count(*) AS count FROM has_keyword h
        JOIN paper p ON p.id = h.paper_id
        WHERE h.keyword_id IN (SELECT value FROM json_each(?1)) AND p.publication_year IS NOT NULL
        GROUP BY h.keyword_id, p.publication_year`,
      )
      .bind(JSON.stringify([...keywords.keys()])),
  ]);
  return { ...kgTrendTable([...keywords.values()], perYear?.results ?? []), missing };
}

function graphOptions(params: URLSearchParams) {
  const centre = kgGraphCentre(params.get('center') ?? params.get('centre') ?? '');
  const depth = params.get('depth') ?? '1';
  const layerText = params.get('layers');
  // No `layers` parameter means every layer; an empty one means the centre alone.
  const layers =
    layerText === null
      ? [...KG_GRAPH_LAYERS]
      : [
          ...new Set(
            layerText
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ];
  const limitText = params.get('limit');
  const limit = limitText === null ? KG_GRAPH_DEFAULT_NODES : Number(limitText);
  if (
    !centre ||
    (depth !== '1' && depth !== '2') ||
    !layers.every((layer): layer is KgGraphLayer => (KG_GRAPH_LAYERS as readonly string[]).includes(layer)) ||
    !Number.isInteger(limit) ||
    limit < 1
  )
    return null;
  return {
    centre: centre.id,
    kind: centre.kind,
    depth: depth === '2' ? (2 as const) : (1 as const),
    layers: layers as KgGraphLayer[],
    limit: Math.min(limit, KG_GRAPH_MAX_NODES),
  };
}

export async function handleKgGraph(
  db: D1Database,
  request: Request,
  path: string,
  headers: Headers,
  projectId: ProjectScope,
) {
  if (request.method !== 'GET') return publishedError(405, 'bad_request', 'Use GET.', headers);
  const params = new URL(request.url).searchParams;
  if (path === '/v1/kg/trend') {
    const requested = [
      ...new Set(
        params
          .getAll('keywords')
          .flatMap((value) => value.split(','))
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    if (!requested.length || requested.length > KG_TREND_LIMIT)
      return publishedError(400, 'bad_request', `Expected 1–${KG_TREND_LIMIT} keywords.`, headers);
    return withEtag(
      request,
      stripProjectIds(await readKgTrend(db, requested, projectId), projectId),
      headers,
    );
  }
  const options = graphOptions(params);
  if (!options)
    return publishedError(
      400,
      'bad_request',
      'Expected a centre (an OpenAlex ID, a DOI or a KG ID), depth 1 or 2, known layers and a positive limit.',
      headers,
    );
  const graph = await readKgGraph(db, options, projectId);
  return graph
    ? withEtag(request, stripProjectIds(graph, projectId), headers)
    : publishedError(404, 'not_found', 'The centre is not in the lab KG.', headers);
}

function stripProjectIds(value: unknown, projectId: ProjectScope): unknown {
  if (typeof value === 'string') return logicalId(projectId, value);
  if (Array.isArray(value)) return value.map((item) => stripProjectIds(item, projectId));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, stripProjectIds(item, projectId)]),
  );
}
