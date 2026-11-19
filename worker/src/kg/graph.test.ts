import { describe, expect, it, vi } from 'vitest';
import { mapOpenAlexWorkToKg } from '../../../src/core/labKg';
import { KgGraphSchema, KgTrendSchema } from '../../../src/core/schemas/labKg';
import { handle, type Deps } from '../app';
import type { KgBindings } from './bindings';
import { kgRepo } from './repo';
import { testDb } from './testDb';

type Work = {
  id: string;
  year: number;
  cites: number;
  keywords: [string, number][];
  refs?: string[];
  authors?: string[];
};

const WORKS: Work[] = [
  {
    id: 'W1',
    year: 2020,
    cites: 50,
    keywords: [
      ['graph neural networks', 0.9],
      ['molecules', 0.5],
    ],
    refs: ['W3', 'W99'],
    authors: ['A1', 'A2'],
  },
  {
    id: 'W2',
    year: 2024,
    cites: 3,
    keywords: [
      ['retrieval', 0.8],
      ['graph neural networks', 0.4],
    ],
    refs: ['W1'],
  },
  { id: 'W3', year: 2005, cites: 2000, keywords: [['lattices', 0.7]] },
  {
    id: 'W4',
    year: 2022,
    cites: 10,
    keywords: [
      ['molecules', 0.7],
      ['message passing', 0.6],
    ],
    refs: ['W1'],
    authors: ['A2'],
  },
];

const slug = (name: string) => `keywords/${name.replace(/\s+/gu, '-')}`;

function raw(work: Work) {
  return {
    id: work.id,
    title: `Synthetic paper ${work.id}`,
    publication_year: work.year,
    cited_by_count: work.cites,
    referenced_works: work.refs ?? [],
    keywords: work.keywords.map(([name, score]) => ({ id: slug(name), display_name: name, score })),
    authorships: (work.authors ?? []).map((id) => ({
      author: { id, display_name: `Author ${id}` },
      institutions: [{ id: 'I1', display_name: 'Synthetic Institute', country_code: 'VN' }],
    })),
    primary_topic:
      work.id === 'W1'
        ? {
            id: 'T1',
            display_name: 'Synthetic topic',
            score: 0.8,
            subfield: { id: 'subfields/2', display_name: 'Subdiscipline' },
            field: { id: 'fields/3', display_name: 'Discipline' },
            domain: { id: 'domains/4', display_name: 'Area' },
          }
        : null,
  };
}

async function setup({ seed = true } = {}) {
  const { db } = testDb();
  if (seed) for (const work of WORKS) await kgRepo(db).upsertWork(mapOpenAlexWorkToKg(raw(work)));
  const bindings: KgBindings = {
    KG: db,
    KG_VECTORS: { upsert: async () => ({}), query: vi.fn(async () => ({ matches: [] })) },
    AI: { run: vi.fn(async () => ({ data: [] })) },
  };
  const deps: Deps = {
    bucket: {
      head: async () => null,
      get: async () => null,
      list: async () => ({ objects: [], truncated: false }),
      put: async () => null,
    },
    verifyToken: async (token) => {
      if (token !== 'lab') throw new Error('bad token');
      return { uid: 'test', email: 'test@example.invalid' };
    },
    allowedOrigins: ['https://example.invalid'],
    now: () => new Date('2026-06-01T00:00:00.000Z'),
    kg: bindings,
  };
  const call = (
    path: string,
    init: { method?: string; token?: string; headers?: Record<string, string> } = {},
  ) =>
    handle(
      deps,
      new Request(`https://worker.test${path}`, {
        method: init.method ?? 'GET',
        headers: {
          ...(init.token === '' ? {} : { Authorization: `Bearer ${init.token ?? 'lab'}` }),
          ...init.headers,
        },
      }),
    );
  const graph = async (query: string) => {
    const response = await call(`/v1/kg/graph?${query}`);
    expect(response.status).toBe(200);
    return KgGraphSchema.parse(await response.json());
  };
  return { call, graph, bindings };
}

describe('L4 GET /v1/kg/graph', () => {
  it('L4 needs a lab account and the KG bindings', async () => {
    const { call, bindings } = await setup({ seed: false });
    expect((await call('/v1/kg/graph?center=W1', { token: '' })).status).toBe(401);
    bindings.AI = undefined;
    for (const path of ['/v1/kg/graph?center=W1', '/v1/kg/trend?keywords=molecules']) {
      const response = await call(path);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: 'kg_not_configured' });
    }
  });

  it('L4 answers a paper centre with its keywords, citations, authors, institutions and topic', async () => {
    const { graph, call } = await setup();
    const result = await graph('center=https://openalex.org/W1');
    expect(result.centre).toBe('W1');
    expect(result.nodes[0]).toMatchObject({ id: 'W1', kind: 'paper', depth: 0, weight: 1, year: 2020 });
    expect(result.nodes.map(({ id }) => id).sort()).toEqual(
      [
        'A1',
        'A2',
        'I1',
        'W1',
        'W2',
        'W3',
        'W4',
        'keywords/graph-neural-networks',
        'keywords/molecules',
        'topics/T1',
      ].sort(),
    );
    const types = new Set(result.edges.map(({ type }) => type));
    expect([...types].sort()).toEqual(['affiliated', 'authored', 'cites', 'has_keyword', 'has_topic']);
    expect(result.edges).toContainEqual({
      source: 'W2',
      target: 'W1',
      type: 'cites',
      weight: expect.any(Number),
    });
    expect(result.outside).toEqual(['W99']);
    expect(result.truncated).toBe(false);
    // Ranked: weight first, then kind order and ID.
    const weights = result.nodes.slice(1).map(({ weight }) => weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));

    const first = await call('/v1/kg/graph?center=W1');
    const etag = first.headers.get('ETag');
    expect(etag).toMatch(/^W\//u);
    expect((await call('/v1/kg/graph?center=W1', { headers: { 'If-None-Match': etag ?? '' } })).status).toBe(
      304,
    );
  });

  it('L4 keeps only the requested layers', async () => {
    const { graph } = await setup();
    const result = await graph('center=W1&layers=keywords');
    expect(result.nodes.map(({ kind }) => kind)).toEqual(['paper', 'keyword', 'keyword']);
    expect(result.edges.every(({ type }) => type === 'has_keyword')).toBe(true);
    expect(result.layers).toEqual(['keywords']);
  });

  it('L4 caps the nodes by weight and drops edges to cut nodes', async () => {
    const { graph } = await setup();
    const result = await graph('center=W1&limit=3');
    // W3 (2000 citations) and A1 (first author) both weigh 1; the paper kind comes first.
    expect(result.nodes.map(({ id }) => id)).toEqual(['W1', 'W3', 'A1']);
    expect(result.truncated).toBe(true);
    expect(result.edges.map(({ type, target }) => `${type}:${target}`).sort()).toEqual([
      'authored:A1',
      'cites:W3',
    ]);
    const capped = await graph('center=W1&limit=999');
    expect(capped.nodes.length).toBeLessThanOrEqual(150);
  });

  it('L4 reaches second-hop nodes at depth 2 with a decayed weight', async () => {
    const { graph } = await setup();
    const one = await graph('center=keywords/molecules');
    expect(one.nodes.map(({ id }) => id)).not.toContain('W2');
    expect(one.edges.some(({ type }) => type === 'cooccur')).toBe(true);
    const two = await graph('center=keywords/molecules&depth=2');
    const w2 = two.nodes.find(({ id }) => id === 'W2');
    expect(w2).toMatchObject({ depth: 2 });
    expect(w2?.weight).toBeLessThanOrEqual(0.5);
    expect(two.depth).toBe(2);
  });

  it('L4 walks the topic hierarchy from a topic centre', async () => {
    const { graph } = await setup();
    const result = await graph('center=topics/T1&depth=2');
    expect(result.nodes.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['W1', 'subfields/2', 'fields/3']),
    );
    expect(result.edges).toContainEqual({
      source: 'topics/T1',
      target: 'subfields/2',
      type: 'hierarchy',
      weight: 1,
    });
  });

  it('L4 rejects malformed requests and names a missing centre', async () => {
    const { call } = await setup();
    for (const query of [
      '',
      'center=W1&depth=3',
      'center=W1&layers=bogus',
      'center=W1&limit=0',
      'center=nope',
    ])
      expect((await call(`/v1/kg/graph?${query}`)).status).toBe(400);
    expect((await call('/v1/kg/graph?center=W404')).status).toBe(404);
    expect((await call('/v1/kg/graph?center=W1', { method: 'POST' })).status).toBe(405);
  });
});

describe('L4 GET /v1/kg/trend', () => {
  it('L4 counts papers per year on a contiguous axis and lists unknown keywords', async () => {
    const { call } = await setup();
    const response = await call('/v1/kg/trend?keywords=keywords/molecules,Graph%20Neural%20Networks,unknown');
    expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).toMatch(/^W\//u);
    const trend = KgTrendSchema.parse(await response.json());
    expect(trend.years).toEqual([2020, 2021, 2022, 2023, 2024]);
    expect(trend.keywords).toEqual([
      { id: 'keywords/molecules', text: 'molecules', total: 2, counts: [1, 0, 1, 0, 0] },
      {
        id: 'keywords/graph-neural-networks',
        text: 'graph neural networks',
        total: 2,
        counts: [1, 0, 0, 0, 1],
      },
    ]);
    expect(trend.missing).toEqual(['unknown']);
  });

  it('L4 needs one to ten keywords', async () => {
    const { call } = await setup();
    expect((await call('/v1/kg/trend')).status).toBe(400);
    const many = Array.from({ length: 11 }, (_, index) => `k${index}`).join(',');
    expect((await call(`/v1/kg/trend?keywords=${many}`)).status).toBe(400);
  });
});
