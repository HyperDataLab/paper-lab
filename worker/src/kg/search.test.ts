import { describe, expect, it, vi } from 'vitest';
import { mapOpenAlexWorkToKg } from '../../../src/core/labKg';
import {
  KG_EDGE_TABLES,
  KgOverviewSchema,
  KgPaperDetailSchema,
  KgSearchResponseSchema,
  KgStatsSchema,
} from '../../../src/core/schemas/labKg';
import { handle, type Deps } from '../app';
import { NotAllowedError } from '../auth';
import { EMBEDDING_MODEL, type KgBindings } from './bindings';
import { kgRepo } from './repo';
import { testDb } from './testDb';

type Work = {
  id: string;
  title: string;
  year: number;
  cites: number;
  keywords: [string, number][];
  refs?: string[];
  authors?: string[];
  source?: string;
};

const WORKS: Work[] = [
  {
    id: 'W1',
    title: 'Graph neural networks for synthetic molecules',
    year: 2020,
    cites: 500,
    keywords: [
      ['graph neural networks', 0.9],
      ['molecules', 0.5],
    ],
    refs: ['W3'],
    authors: ['A1', 'A2'],
    source: 'S1',
  },
  {
    id: 'W2',
    title: 'Synthetic retrieval with transformers',
    year: 2024,
    cites: 3,
    keywords: [
      ['retrieval', 0.8],
      ['graph neural networks', 0.4],
    ],
  },
  { id: 'W3', title: 'Old foundations of lattices', year: 2005, cites: 2000, keywords: [['lattices', 0.7]] },
  {
    id: 'W4',
    title: 'Graph message passing for synthetic molecules',
    year: 2022,
    cites: 10,
    keywords: [
      ['molecules', 0.7],
      ['message passing', 0.6],
    ],
    refs: ['W1'],
  },
];

const slug = (name: string) => `keywords/${name.replace(/\s+/gu, '-')}`;
const PROJECT_ID = '00000000-0000-4000-8000-000000000101';
const scopedId = (id: string) => `@rh/${PROJECT_ID}/${id}`;

function raw(work: Work) {
  return {
    id: work.id,
    title: work.title,
    publication_year: work.year,
    cited_by_count: work.cites,
    abstract_inverted_index: { Synthetic: [0], abstract: [1] },
    referenced_works: work.refs ?? [],
    keywords: work.keywords.map(([name, score]) => ({ id: slug(name), display_name: name, score })),
    authorships: (work.authors ?? []).map((id) => ({
      author: { id, display_name: `Author ${id}` },
      institutions: [{ id: 'I1', display_name: 'Synthetic Institute', country_code: 'VN' }],
    })),
    primary_location: work.source ? { source: { id: work.source, display_name: 'Synthetic Journal' } } : null,
    primary_topic:
      work.id === 'W1'
        ? {
            id: 'T1',
            display_name: 'Synthetic topic',
            score: 0.9,
            subfield: { id: 'subfields/2', display_name: 'Subdiscipline' },
            field: { id: 'fields/3', display_name: 'Discipline' },
            domain: { id: 'domains/4', display_name: 'Area' },
          }
        : null,
  };
}

async function setup({ seed = true, matches = [] as { id: string; score: number }[] } = {}) {
  const { db, sqlite } = testDb();
  if (seed) for (const work of WORKS) await kgRepo(db, PROJECT_ID).upsertWork(mapOpenAlexWorkToKg(raw(work)));
  const run = vi.fn(async () => ({ data: [Array.from({ length: 768 }, () => 0.1)] }));
  const query = vi.fn(async () => ({ matches }));
  const bindings: KgBindings = { KG: db, KG_VECTORS: { upsert: async () => ({}), query }, AI: { run } };
  const deps: Deps = {
    bucket: {
      head: async () => null,
      get: async () => null,
      list: async () => ({ objects: [], truncated: false }),
      put: async () => null,
    },
    verifyToken: async (token) => {
      if (token === 'outsider') throw new NotAllowedError();
      if (token !== 'lab') throw new Error('bad token');
      return { uid: 'test', email: 'test@example.invalid' };
    },
    allowedOrigins: ['https://example.invalid'],
    getOwnedProject: async (id) => id === PROJECT_ID ? { id, name: 'Test project' } : null,
    now: () => new Date('2026-06-01T00:00:00.000Z'),
    kg: bindings,
  };
  const call = (
    path: string,
    init: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
  ) =>
    handle(
      deps,
      new Request(`https://worker.test${path}`, {
        method: init.body === undefined ? 'GET' : 'POST',
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        headers: {
          ...(init.token === '' ? {} : { Authorization: `Bearer ${init.token ?? 'lab'}` }),
          'X-Project-Id': PROJECT_ID,
          ...init.headers,
        },
      }),
    );
  const search = async (body: Record<string, unknown>) => {
    const response = await call('/v1/kg/search', { body });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    return KgSearchResponseSchema.parse(await response.json());
  };
  return { call, search, run, query, bindings, sqlite };
}

describe('L3 POST /v1/kg/search', () => {
  it('L3 requires a lab account and the KG bindings', async () => {
    const { call, bindings } = await setup({ seed: false });
    const body = { keywords: [{ text: 'molecules', level: 'high' }] };
    expect((await call('/v1/kg/search', { body, token: '' })).status).toBe(401);
    expect((await call('/v1/kg/search', { body, token: 'nope' })).status).toBe(401);
    expect((await call('/v1/kg/search', { body, token: 'outsider' })).status).toBe(403);
    bindings.KG_VECTORS = undefined;
    for (const path of [
      '/v1/kg/search',
      '/v1/kg/stats',
      '/v1/kg/overview',
      '/v1/kg/papers/W1',
      '/v1/kg/keywords/k',
    ]) {
      const response = await call(path, path.endsWith('search') ? { body } : {});
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: 'kg_not_configured' });
    }
  });

  it('L3 rejects a request without anchors, naming only the field', async () => {
    const { call } = await setup({ seed: false });
    const response = await call('/v1/kg/search', { body: { query: 'secret text' } });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain('keywords');
    expect(body.message).not.toContain('secret text');
  });

  it('L3 answers an empty KG with no papers and a hint, without embedding', async () => {
    const { search, run } = await setup({ seed: false });
    const result = await search({ keywords: [{ text: 'molecules', level: 'high' }] });
    expect(result).toMatchObject({ papers: [], hint: 'kg_empty' });
    expect(run).not.toHaveBeenCalled();
  });

  it('L3 keyword mode ranks by FTS and keyword level without calling Vectorize', async () => {
    const { search, run, query } = await setup();
    const result = await search({
      keywords: [{ text: 'graph neural networks', level: 'high' }],
      mode: 'keyword',
      ranking: 'precision',
    });
    expect(run).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(result.papers.map(({ id }) => id).slice(0, 2)).toEqual(['W1', 'W2']);
    expect(result.papers[0]).toMatchObject({
      rank: 1,
      title: 'Graph neural networks for synthetic molecules',
      year: 2020,
      citations: 500,
      venue: 'Synthetic Journal',
      authors: ['Author A1', 'Author A2'],
      openalexId: 'W1',
      abstract: 'Synthetic abstract',
    });
    expect(result.papers.every(({ score }) => score !== null && score > 0 && score <= 1)).toBe(true);
    expect(result.papers.find(({ id }) => id === 'W3')).toBeUndefined();
  });

  it('L3 survives FTS5 operators and quotes in the query text', async () => {
    const { search } = await setup();
    const result = await search({
      query: 'graph-neural "molecules" NOT: AND (OR) *',
      keywords: [{ text: 'mol"ecules: NEAR', level: 'middle' }],
      mode: 'keyword',
    });
    expect(result.papers.map(({ id }) => id)).toContain('W1');
  });

  it('L3 keeps the exact keyword among many partial matches and expands through co-occurrence', async () => {
    const { search, sqlite } = await setup();
    for (let i = 0; i < 6; i++)
      sqlite
        .prepare(`INSERT INTO keyword (id, text, text_normalized) VALUES (?, ?, ?)`)
        .run(`keywords/a${i}`, `message passing ${i}`, `message passing ${i}`);
    const result = await search({ keywords: [{ text: 'message passing', level: 'high' }] });
    const ids = result.papers.map(({ id }) => id);
    expect(ids[0]).toBe('W4');
    // W1 carries "molecules", which co-occurs with "message passing" on W4; it has no other link to the query.
    expect(ids).toContain('W1');
  });

  it('L3 filters by publication year', async () => {
    const { search } = await setup();
    const result = await search({
      keywords: [{ text: 'graph neural networks', level: 'high' }],
      mode: 'keyword',
      after: '2021-01-01',
      before: '2025-12-31',
    });
    // W1 (2020) is out of range; W4 matches "graph" in its title through FTS.
    expect(result.papers.map(({ id }) => id)).toEqual(['W2', 'W4']);
  });

  it('L3 title mode matches titles and leaves out the anchor paper itself', async () => {
    const { search, run } = await setup();
    const result = await search({
      titles: [{ title: 'Graph neural networks for synthetic molecules', level: 'high' }],
      mode: 'title',
    });
    expect(run).not.toHaveBeenCalled();
    const ids = result.papers.map(({ id }) => id);
    expect(ids[0]).toBe('W4');
    expect(ids).not.toContain('W1');
  });

  it('L3 semantic mode embeds the query with bge-base and ranks Vectorize matches', async () => {
    const { search, run, query } = await setup({
      matches: [
        { id: scopedId('W3'), score: 0.9 },
        { id: scopedId('W2'), score: 0.5 },
        { id: scopedId('W404'), score: 0.95 },
      ],
    });
    const result = await search({
      query: 'lattice foundations',
      keywords: [{ text: 'lattices', level: 'low' }],
      mode: 'semantic',
      ranking: 'precision',
    });
    expect(run).toHaveBeenCalledWith(EMBEDDING_MODEL, { text: ['lattice foundations'] });
    expect(query).toHaveBeenCalledWith(expect.any(Array), { topK: 50 });
    // W404 is in Vectorize but not in D1, so it is dropped.
    expect(result.papers.map(({ id }) => id)).toEqual(['W3', 'W2']);
  });

  it('L3 hybrid mode boosts papers citing an anchor and survives a failed embedding', async () => {
    const { search, run } = await setup();
    run.mockRejectedValueOnce(new Error('synthetic outage'));
    const result = await search({
      keywords: [{ text: 'molecules', level: 'high' }],
      titles: [{ title: 'Graph neural networks for synthetic molecules', level: 'high' }],
    });
    const ids = result.papers.map(({ id }) => id);
    // W4 shares the keyword, is close in title and cites the anchor paper W1; W3 is cited by W1.
    expect(ids[0]).toBe('W4');
    expect(ids).toContain('W3');
    expect(ids).not.toContain('W1');
  });

  it('L3 a semantic search with a failed embedding is a 502', async () => {
    const { call, run } = await setup();
    run.mockRejectedValueOnce(new Error('synthetic outage'));
    const response = await call('/v1/kg/search', {
      body: { keywords: [{ text: 'molecules', level: 'high' }], mode: 'semantic' },
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'kg_error' });
  });
});

describe('L3 KG reads', () => {
  it('L3 reads a paper with its neighbours by layer, with an ETag', async () => {
    const { call, sqlite } = await setup();
    sqlite
      .prepare(
        `INSERT INTO contribution (id, published_paper_id, paper_doi, name, description, review, body)
        VALUES (?, ?, NULL, 'Synthetic method', 'A method', 'accepted', '{}')`,
      )
      .run(scopedId('c1'), scopedId('pub1'));
    const response = await call('/v1/kg/papers/W1');
    expect(response.status).toBe(200);
    const etag = response.headers.get('ETag');
    expect(etag).toMatch(/^W\/"[0-9a-f]+"$/u);
    const detail = KgPaperDetailSchema.parse(await response.json());
    expect(detail.paper).toMatchObject({
      id: 'W1',
      year: 2020,
      venue: { id: 'S1', name: 'Synthetic Journal' },
    });
    expect(detail.keywords.map(({ text }) => text)).toEqual(['graph neural networks', 'molecules']);
    expect(detail.topics[0]).toMatchObject({
      id: 'topics/T1',
      subfield: { id: 'subfields/2' },
      field: { id: 'fields/3' },
      domain: { id: 'domains/4', name: 'Area' },
    });
    expect(detail.authors.map(({ id, position }) => [id, position])).toEqual([
      ['A1', 1],
      ['A2', 2],
    ]);
    expect(detail.authors[0]?.institutions).toEqual([
      { id: 'I1', name: 'Synthetic Institute', ror: null, countryCode: 'VN' },
    ]);
    expect(detail.cites.map(({ id }) => id)).toEqual(['W3']);
    expect(detail.citedBy.map(({ id }) => id)).toEqual(['W4']);
    // The contribution has no DOI, and W1 has none either, so nothing is linked.
    expect(detail.contributions).toEqual([]);

    const again = await call('/v1/kg/papers/W1', { headers: { 'If-None-Match': etag ?? '' } });
    expect(again.status).toBe(304);
    expect((await call('/v1/kg/papers/W999')).status).toBe(404);
    expect((await call('/v1/kg/papers/not-an-id')).status).toBe(400);
  });

  it('L3 links contributions by DOI', async () => {
    const { call, sqlite } = await setup();
    sqlite.prepare(`UPDATE paper SET doi = '10.1000/synthetic' WHERE id = ?`).run(scopedId('W4'));
    sqlite
      .prepare(
        `INSERT INTO contribution (id, published_paper_id, paper_doi, name, description, review, body)
        VALUES (?, ?, '10.1000/synthetic', 'Synthetic method', 'A method', 'candidate', '{}')`,
      )
      .run(scopedId('c1'), scopedId('pub1'));
    const byDoi = await call(`/v1/kg/papers/${encodeURIComponent('https://doi.org/10.1000/Synthetic')}`);
    expect(byDoi.status).toBe(200);
    const detail = KgPaperDetailSchema.parse(await byDoi.json());
    expect(detail.paper.id).toBe('W4');
    expect(detail.contributions).toEqual([
      { id: 'c1', name: 'Synthetic method', description: 'A method', review: 'candidate' },
    ]);
  });

  it('L3 reads a keyword by raw or encoded id with co-occurrence and papers per year', async () => {
    const { call } = await setup();
    for (const path of ['/v1/kg/keywords/keywords/molecules', '/v1/kg/keywords/keywords%2Fmolecules']) {
      const response = await call(path);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        keyword: unknown;
        cooccurring: { id: string; jaccard: number }[];
        papersPerYear: unknown;
      };
      expect(body.keyword).toEqual({ id: 'keywords/molecules', text: 'molecules', frequency: 2 });
      expect(body.papersPerYear).toEqual([
        { year: 2020, count: 1 },
        { year: 2022, count: 1 },
      ]);
      // molecules (2 papers) shares 1 paper with message passing (1) and 1 with graph neural networks (2).
      expect(body.cooccurring.map(({ id, jaccard }) => [id, Number(jaccard.toFixed(3))])).toEqual([
        ['keywords/message-passing', 0.5],
        ['keywords/graph-neural-networks', 0.333],
      ]);
    }
    expect((await call('/v1/kg/keywords/keywords%2Fnone')).status).toBe(404);
  });

  it('L3 counts nodes, edges and the queue', async () => {
    const { call } = await setup();
    const response = await call('/v1/kg/stats');
    expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).toBeTruthy();
    const stats = KgStatsSchema.parse(await response.json());
    expect(stats.nodes).toMatchObject({ paper: 4, keyword: 5, author: 2, institution: 1, topic: 1 });
    expect(stats.edges).toMatchObject({ has_keyword: 7, cites: 2, authored: 2, coauthor: 1 });
    expect(stats.queue).toEqual({ pending: 0, processing: 0, done: 0, failed: 0 });
  });

  it('L3 counts an empty KG within D1 limits (no compound SELECT over five terms)', async () => {
    // Regression: one UNION ALL over all 22 tables failed on D1 with "too many terms in compound SELECT",
    // so /v1/kg/stats answered 500 on the live worker.
    const { call } = await setup({ seed: false });
    const response = await call('/v1/kg/stats');
    expect(response.status).toBe(200);
    const stats = KgStatsSchema.parse(await response.json());
    expect(Object.values(stats.nodes).every((value) => value === 0)).toBe(true);
    expect(Object.keys(stats.edges)).toHaveLength(KG_EDGE_TABLES.length);
  });

  it('L4 lists starting points: most cited papers and most frequent keywords', async () => {
    const { call } = await setup();
    const response = await call('/v1/kg/overview');
    expect(response.status).toBe(200);
    const overview = KgOverviewSchema.parse(await response.json());
    expect(overview.papers.map(({ id }) => id)).toEqual(['W3', 'W1', 'W4', 'W2']);
    expect(overview.keywords[0]).toMatchObject({ frequency: 2 });
    expect(overview.keywords.map(({ id }) => id)).toContain('keywords/lattices');
    const empty = await (await setup({ seed: false })).call('/v1/kg/overview');
    expect(KgOverviewSchema.parse(await empty.json())).toEqual({ papers: [], keywords: [] });
  });
});
