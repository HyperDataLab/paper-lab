import { describe, expect, it } from 'vitest';
import { exampleCorpus } from '../../../src/core/corpus/contract';
import type { Paper } from '../../../src/core/schemas/paper';
import { handle, type Deps } from '../app';
import { NotAllowedError } from '../auth';
import { memoryBucket } from '../data/testBucket';
import { testDb } from '../kg/testDb';
import { configuredPassages, LAB_PASSAGE_SCOPE, passageVectorId } from './bindings';
import { drainPassageQueue } from './index';
import { fuseRankings, RRF_K, searchPassages } from './search';
import { MIN_PASSAGE_CHARS } from './split';
import { fakeAi, fakeVectors } from './testFakes';

const START = new Date('2026-11-25T00:00:00.000Z');
const PROJECT = '00000000-0000-4000-8000-000000000101';
const OTHER = '00000000-0000-4000-8000-000000000102';
const PAPER_A = '00000000-0000-4000-8000-0000000000a1';
const PAPER_B = '00000000-0000-4000-8000-0000000000b1';

const STALENESS =
  'We measure gradient staleness as the number of server updates between a client download and its upload, and report accuracy under bounded staleness.';
const RESULTS =
  'Staleness-aware weighting improved final accuracy by 4.2 points on CIFAR-10 compared with FedAsync at the same staleness bound.';
const INTRO =
  'Federated learning trains a shared model across many clients without collecting their raw data in one place.';

function paper(
  id: string,
  title: string,
  paragraphs: { id: string; section: string; text: string; kind?: string }[],
) {
  const value: Paper = {
    schemaVersion: 1,
    id,
    title,
    createdAt: START.toISOString(),
    updatedAt: START.toISOString(),
    source: { kind: 'text', fileName: `${title}.txt`, pageCount: null, sha256: `sha-${id}` },
    sections: [
      { id: 's-intro', heading: 'Introduction', role: 'introduction', level: 1, pageStart: null },
      { id: 's-methods', heading: 'Methods', role: 'methods', level: 1, pageStart: null },
      { id: 's-results', heading: 'Results', role: 'results', level: 1, pageStart: null },
      { id: 's-refs', heading: 'References', role: 'references', level: 1, pageStart: null },
    ],
    paragraphs: paragraphs.map((paragraph, order) => ({
      id: paragraph.id,
      sectionId: paragraph.section,
      order,
      text: paragraph.text,
      pageStart: null,
      kind: (paragraph.kind ?? 'body') as Paper['paragraphs'][number]['kind'],
      textHash: `h-${paragraph.id}`,
    })),
  };
  return value;
}

const paperA = () =>
  paper(PAPER_A, 'Asynchronous federated learning', [
    { id: 'p1', section: 's-intro', text: INTRO },
    { id: 'p2', section: 's-methods', text: STALENESS },
    { id: 'p3', section: 's-results', text: RESULTS },
    { id: 'p4', section: 's-results', text: 'Table 2 shows it.' },
    {
      id: 'p5',
      section: 's-refs',
      text: `[1] A reference entry about staleness in federated learning. ${INTRO}`,
    },
    { id: 'p6', section: 's-methods', text: `[2] Another staleness reference. ${INTRO}`, kind: 'reference' },
  ]);

function setup(options: { vectors?: boolean; ignoreFilters?: boolean } = {}) {
  const now = () => START;
  const { db, sqlite } = testDb('migrations-data');
  const { bucket } = memoryBucket(now);
  const ai = fakeAi();
  const vectors = fakeVectors({ ignoreFilters: options.ignoreFilters });
  const deps: Deps = {
    bucket,
    verifyToken: async (token) => {
      if (token === 'outsider') throw new NotAllowedError();
      if (token === 'lab') return { uid: 'a', email: 'a@hyperdatalab.org', kind: 'sso' };
      if (token === 'firebase') return { uid: 'a', email: 'a@hyperdatalab.org', kind: 'firebase' };
      throw new Error('bad token');
    },
    allowedOrigins: [],
    now,
    data: db,
    kg: { AI: ai },
    passageVectors: options.vectors === false ? undefined : vectors.index,
    getOwnedProject: async (projectId) => ({ id: projectId, name: projectId }),
  };
  const env = configuredPassages({ db, bucket, vectors: vectors.index, ai });
  if (!env) throw new Error('Passage env not configured');
  const call = (
    method: string,
    path: string,
    body?: unknown,
    {
      project = PROJECT,
      token = 'lab',
      headers = {},
    }: { project?: string | null; token?: string | null; headers?: Record<string, string> } = {},
  ) =>
    handle(
      deps,
      new Request(`https://worker.example${path}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(project ? { 'X-Project-Id': project } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  const versions = new Map<string, number>();
  const put = async (collection: string, id: string, body: unknown, project: string | null = PROJECT) => {
    const key = `${project}/${collection}/${id}`;
    const version = versions.get(key);
    const response = await call('PUT', `/v1/data/${collection}/${id}`, body, {
      project,
      headers: version ? { 'if-match': `"v${version}"` } : { 'if-none-match': '*' },
    });
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    versions.set(key, ((await response.json()) as { version: number }).version);
  };
  const remove = async (collection: string, id: string, project = PROJECT) => {
    const key = `${project}/${collection}/${id}`;
    const response = await call('DELETE', `/v1/data/${collection}/${id}`, undefined, {
      project,
      headers: { 'if-match': `"v${versions.get(key)}"` },
    });
    expect(response.status).toBe(200);
    versions.delete(key);
  };
  const drain = () => drainPassageQueue(env, { now });
  const search = async (
    body: Record<string, unknown>,
    project: string | null = PROJECT,
    token = project ? 'lab' : 'firebase',
  ) => {
    const response = await call('POST', '/v1/passages/search', body, { project, token });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const rows = (project = PROJECT) =>
    sqlite
      .prepare(
        'SELECT paper_id, paragraph_id, section_role, vector_id FROM passage WHERE project_id = ? ORDER BY ord',
      )
      .all(project) as { paper_id: string; paragraph_id: string; section_role: string; vector_id: string }[];
  return { db, sqlite, ai, vectors, env, call, put, remove, drain, search, rows };
}

type Hit = {
  paperId: string;
  paragraphId: string;
  sectionRole: string;
  text: string;
  paperTitle: string | null;
  sources: string[];
};
const hits = (body: Record<string, unknown>) => body.passages as Hit[];

describe('passage index', () => {
  it('queues a paper when it is written through the data store, then splits and indexes it', async () => {
    const t = setup();
    await t.put('papers', PAPER_A, paperA());
    expect(t.sqlite.prepare('SELECT project_id, paper_id, status FROM passage_queue').all()).toEqual([
      { project_id: PROJECT, paper_id: PAPER_A, status: 'pending' },
    ]);
    expect(await t.drain()).toMatchObject({ processed: 1, embedded: 3, errors: [] });
    // Short paragraphs, the References section and reference paragraphs are left out.
    expect(t.rows().map((row) => [row.paragraph_id, row.section_role])).toEqual([
      ['p1', 'introduction'],
      ['p2', 'methods'],
      ['p3', 'results'],
    ]);
    expect(MIN_PASSAGE_CHARS).toBeGreaterThan('Table 2 shows it.'.length);
    const vectorId = await passageVectorId(PROJECT, PAPER_A, 'p2');
    expect(new TextEncoder().encode(vectorId).byteLength).toBeLessThanOrEqual(64);
    expect(t.vectors.stored.get(vectorId)?.metadata).toEqual({
      projectId: PROJECT,
      paperId: PAPER_A,
      paragraphId: 'p2',
      sectionRole: 'methods',
    });
    expect(t.sqlite.prepare('SELECT status FROM passage_queue').get()).toEqual({ status: 'done' });
    expect(
      t.sqlite.prepare("SELECT count(*) AS n FROM passage_fts WHERE passage_fts MATCH 'measuring'").get(),
    ).toEqual({
      n: 1,
    });
  });

  it('skips paragraphs whose text hash is unchanged and re-embeds only what changed', async () => {
    const t = setup();
    await t.put('papers', PAPER_A, paperA());
    await t.drain();
    t.ai.calls.length = 0;
    const edited = paperA();
    edited.title = 'Renamed paper';
    (edited.paragraphs[2] as { text: string }).text = `${RESULTS} The gain held across five seeds.`;
    await t.put('papers', PAPER_A, edited);
    expect(await t.drain()).toMatchObject({ processed: 1, embedded: 1 });
    expect(t.ai.calls.flat()).toEqual([`${RESULTS} The gain held across five seeds.`]);
    // A section role change re-embeds, since the role is in the vector metadata.
    const moved = structuredClone(edited);
    (moved.paragraphs[0] as { sectionId: string }).sectionId = 's-methods';
    await t.put('papers', PAPER_A, moved);
    expect(await t.drain()).toMatchObject({ embedded: 1 });
    expect(t.rows()[0]).toMatchObject({ paragraph_id: 'p1', section_role: 'methods' });
  });

  it('removes deleted paragraphs and deleted papers from D1, FTS and Vectorize', async () => {
    const t = setup();
    await t.put('papers', PAPER_A, paperA());
    await t.drain();
    const trimmed = paperA();
    trimmed.paragraphs = trimmed.paragraphs.filter((paragraph) => paragraph.id !== 'p3');
    await t.put('papers', PAPER_A, trimmed);
    await t.drain();
    expect(t.rows().map((row) => row.paragraph_id)).toEqual(['p1', 'p2']);
    expect(t.vectors.stored.has(await passageVectorId(PROJECT, PAPER_A, 'p3'))).toBe(false);
    expect(t.vectors.stored.size).toBe(2);

    await t.remove('papers', PAPER_A);
    await t.drain();
    expect(t.rows()).toEqual([]);
    expect(t.vectors.stored.size).toBe(0);
    expect(
      t.sqlite.prepare("SELECT count(*) AS n FROM passage_fts WHERE passage_fts MATCH 'staleness'").get(),
    ).toEqual({
      n: 0,
    });
  });

  it('finishes a job only when the paper did not change while it was indexed', async () => {
    const t = setup();
    await t.put('papers', PAPER_A, paperA());
    const [job] = t.sqlite.prepare('SELECT generation FROM passage_queue').all() as { generation: number }[];
    await t.put('papers', PAPER_A, { ...paperA(), title: 'Again' });
    expect(t.sqlite.prepare('SELECT generation, status FROM passage_queue').get()).toEqual({
      generation: (job?.generation ?? 0) + 1,
      status: 'pending',
    });
    await t.drain();
    expect(t.sqlite.prepare('SELECT status FROM passage_queue').get()).toEqual({ status: 'done' });
  });

  it('retries a failed embedding with backoff and keeps the old passages', async () => {
    let fail = false;
    const t = setup();
    await t.put('papers', PAPER_A, paperA());
    await t.drain();
    const failing = configuredPassages({
      ...t.env,
      ai: {
        run: async (model, input) => {
          if (fail) throw new Error('down');
          return t.ai.run(model, input);
        },
      },
    });
    fail = true;
    const edited = paperA();
    (edited.paragraphs[1] as { text: string }).text = `${STALENESS} Updated.`;
    await t.put('papers', PAPER_A, edited);
    if (!failing) throw new Error('not configured');
    expect(await drainPassageQueue(failing, { now: () => START })).toMatchObject({
      processed: 0,
      errors: [{ paperId: PAPER_A, code: 'embedding_failed' }],
    });
    expect(t.sqlite.prepare('SELECT status, attempts, last_error, next_at FROM passage_queue').get()).toEqual(
      {
        status: 'pending',
        attempts: 1,
        last_error: 'embedding_failed',
        next_at: new Date(START.getTime() + 60_000).toISOString(),
      },
    );
    expect(t.rows()).toHaveLength(3);
  });
});

describe('POST /v1/passages/search', () => {
  async function indexed(options: Parameters<typeof setup>[0] = {}) {
    const t = setup(options);
    await t.put('papers', PAPER_A, paperA());
    await t.put(
      'papers',
      PAPER_B,
      paper(PAPER_B, 'Synchronous baselines', [
        {
          id: 'q1',
          section: 's-results',
          text: `Synchronous FedAvg reached the same accuracy without any staleness. ${INTRO}`,
        },
      ]),
    );
    // The same paper text in another project must never be returned.
    await t.put('papers', PAPER_A, paperA(), OTHER);
    await t.drain();
    return t;
  }

  it('returns hybrid hits with citation anchors, titles and their sources', async () => {
    const t = await indexed();
    const { status, body } = await t.search({ query: 'how is staleness measured', limit: 3 });
    expect(status).toBe(200);
    const [first] = hits(body);
    expect(first).toMatchObject({
      paperId: PAPER_A,
      paragraphId: 'p2',
      sectionRole: 'methods',
      paperTitle: 'Asynchronous federated learning',
      text: STALENESS,
    });
    expect(first?.sources.sort()).toEqual(['keyword', 'vector']);
    expect(body.truncated).toBe(true);
    expect(hits(body)).toHaveLength(3);
  });

  it('keeps projects apart even when the vector index ignores its filter', async () => {
    for (const ignoreFilters of [false, true]) {
      const t = await indexed({ ignoreFilters });
      const { body } = await t.search({ query: 'staleness accuracy', limit: 50 });
      expect(hits(body).length).toBeGreaterThan(0);
      expect(t.rows(OTHER)).toHaveLength(3);
      const { body: other } = await t.search({ query: 'staleness accuracy', limit: 50 }, OTHER);
      expect(new Set(hits(other).map((hit) => hit.paperId))).toEqual(new Set([PAPER_A]));
      expect(hits(body).filter((hit) => hit.paperId === PAPER_B)).toHaveLength(1);
      // Project A's hits come from project A's rows only: B exists only there.
      expect(hits(other).some((hit) => hit.paperId === PAPER_B)).toBe(false);
    }
  });

  it('filters by corpus, paper list and section role', async () => {
    const t = await indexed();
    const corpus = exampleCorpus();
    const [member] = corpus.members;
    if (!member) throw new Error('Missing synthetic member');
    corpus.members = [{ ...member, identifiers: { ...member.identifiers, paperIds: [PAPER_B] } }];
    await t.put('corpora', corpus.id, corpus);

    const byCorpus = await t.search({ query: 'staleness', corpusId: corpus.id });
    expect(new Set(hits(byCorpus.body).map((hit) => hit.paperId))).toEqual(new Set([PAPER_B]));
    expect(t.vectors.queries.at(-1)).toEqual({ projectId: { $eq: PROJECT }, paperId: { $in: [PAPER_B] } });

    const disjoint = await t.search({ query: 'staleness', corpusId: corpus.id, paperIds: [PAPER_A] });
    expect(disjoint.body).toEqual({ passages: [], truncated: false });

    const byRole = await t.search({ query: 'staleness accuracy', sectionRoles: ['results'], limit: 50 });
    expect(new Set(hits(byRole.body).map((hit) => hit.sectionRole))).toEqual(new Set(['results']));

    const missing = await t.search({ query: 'staleness', corpusId: 'no-such-corpus' });
    expect(missing).toEqual({ status: 404, body: expect.objectContaining({ error: 'corpus_not_found' }) });
    // A corpus of another project is not visible.
    expect((await t.search({ query: 'staleness', corpusId: corpus.id }, OTHER)).status).toBe(404);
  });

  it('answers from keywords alone when the embedding fails', async () => {
    const t = await indexed();
    const down = { ...t.env, ai: { run: async () => Promise.reject(new Error('down')) } };
    const result = await searchPassages(down, { query: 'staleness', limit: 5 }, PROJECT);
    expect(result.passages.length).toBeGreaterThan(0);
    expect(result.passages.every((hit) => hit.sources.join() === 'keyword')).toBe(true);
  });

  it('validates the request and never echoes the query', async () => {
    const t = await indexed();
    const response = await t.search({ query: 'secret question', limit: 51 });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain('secret question');
    expect((await t.search({ query: '   ' })).status).toBe(400);
  });

  it('answers 503 passages_not_configured without the Vectorize binding', async () => {
    const t = setup({ vectors: false });
    const response = await t.call('POST', '/v1/passages/search', { query: 'staleness' });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'passages_not_configured' });
  });

  it('requires a lab sign-in, and SSO for project scope', async () => {
    const t = setup();
    expect((await t.call('POST', '/v1/passages/search', { query: 'x' }, { token: null })).status).toBe(401);
    expect((await t.call('POST', '/v1/passages/search', { query: 'x' }, { token: 'outsider' })).status).toBe(
      403,
    );
    // A Firebase token has lab scope only (ADR-0009).
    expect((await t.call('POST', '/v1/passages/search', { query: 'x' }, { token: 'firebase' })).status).toBe(
      403,
    );
    expect(
      (await t.call('POST', '/v1/passages/search', { query: 'x' }, { token: 'firebase', project: null }))
        .status,
    ).toBe(200);
  });
});

describe('lab scope (no project id)', () => {
  async function both() {
    const t = setup();
    // The lab and a project hold the same paper id; only the lab also holds PAPER_B.
    await t.put('papers', PAPER_A, paperA(), null);
    await t.put(
      'papers',
      PAPER_B,
      paper(PAPER_B, 'Lab only paper', [
        {
          id: 'q1',
          section: 's-results',
          text: `Lab measurements of staleness in asynchronous training. ${INTRO}`,
        },
      ]),
      null,
    );
    await t.put('papers', PAPER_A, paperA());
    await t.drain();
    return t;
  }

  it('indexes lab papers under the lab scope key and Vectorize projectId', async () => {
    const t = await both();
    expect(
      t.sqlite.prepare('SELECT DISTINCT project_id FROM passage_queue ORDER BY project_id').all(),
    ).toEqual([{ project_id: PROJECT }, { project_id: LAB_PASSAGE_SCOPE }]);
    expect(
      t
        .rows(LAB_PASSAGE_SCOPE)
        .map((row) => row.paper_id)
        .sort(),
    ).toEqual([PAPER_A, PAPER_A, PAPER_A, PAPER_B]);
    const vectorId = await passageVectorId(LAB_PASSAGE_SCOPE, PAPER_B, 'q1');
    expect(t.vectors.stored.get(vectorId)?.metadata.projectId).toBe(LAB_PASSAGE_SCOPE);
  });

  it('searches, reindexes and reports status without a project id', async () => {
    const t = await both();
    const { status, body } = await t.search({ query: 'staleness measurement', limit: 50 }, null);
    expect(status).toBe(200);
    expect(new Set(hits(body).map((hit) => hit.paperId))).toEqual(new Set([PAPER_A, PAPER_B]));
    expect(hits(body).find((hit) => hit.paperId === PAPER_B)?.paperTitle).toBe('Lab only paper');
    expect(t.vectors.queries.at(-1)).toEqual({ projectId: { $eq: LAB_PASSAGE_SCOPE } });

    t.sqlite.exec('DELETE FROM passage_queue');
    const reindex = await t.call('POST', '/v1/passages/reindex', {}, { project: null, token: 'firebase' });
    expect(await reindex.json()).toMatchObject({ queued: 2, status: { passages: 4, papers: 2 } });
    // The project's paper was not queued by the lab's reindex.
    expect(
      t.sqlite.prepare('SELECT count(*) AS n FROM passage_queue WHERE project_id = ?').get(PROJECT),
    ).toEqual({ n: 0 });
    const statusResponse = await t.call('GET', '/v1/passages/status', undefined, { project: null });
    expect(await statusResponse.json()).toMatchObject({ passages: 4, papers: 2 });
  });

  it('keeps the lab and projects apart in both directions, even without vector filters', async () => {
    for (const ignoreFilters of [false, true]) {
      const t = setup({ ignoreFilters });
      await t.put(
        'papers',
        PAPER_B,
        paper(PAPER_B, 'Lab only paper', [
          { id: 'q1', section: 's-results', text: `Lab measurements of staleness in training. ${INTRO}` },
        ]),
        null,
      );
      await t.put('papers', PAPER_A, paperA());
      await t.drain();
      const lab = await t.search({ query: 'staleness', limit: 50 }, null);
      expect(new Set(hits(lab.body).map((hit) => hit.paperId))).toEqual(new Set([PAPER_B]));
      const project = await t.search({ query: 'staleness', limit: 50 });
      expect(new Set(hits(project.body).map((hit) => hit.paperId))).toEqual(new Set([PAPER_A]));
      // A project paper id named from the lab finds nothing, and the reverse.
      expect(hits((await t.search({ query: 'staleness', paperIds: [PAPER_A] }, null)).body)).toEqual([]);
      expect(hits((await t.search({ query: 'staleness', paperIds: [PAPER_B] })).body)).toEqual([]);
    }
  });

  it('resolves lab corpora in lab scope only', async () => {
    const t = await both();
    const corpus = exampleCorpus();
    const [member] = corpus.members;
    if (!member) throw new Error('Missing synthetic member');
    corpus.members = [{ ...member, identifiers: { ...member.identifiers, paperIds: [PAPER_B] } }];
    await t.put('corpora', corpus.id, corpus, null);
    const lab = await t.search({ query: 'staleness', corpusId: corpus.id }, null);
    expect(new Set(hits(lab.body).map((hit) => hit.paperId))).toEqual(new Set([PAPER_B]));
    expect((await t.search({ query: 'staleness', corpusId: corpus.id })).status).toBe(404);
    expect(
      (await t.search({ query: 'staleness', corpusId: `@rh/${PROJECT}/${corpus.id}` }, null)).status,
    ).toBe(404);
  });
});

describe('POST /v1/passages/reindex and GET /v1/passages/status', () => {
  it('backfills the project, indexes one paper at once and reports the queue', async () => {
    const t = setup();
    await t.put('papers', PAPER_A, paperA());
    await t.put('papers', PAPER_A, paperA(), OTHER);
    t.sqlite.exec('DELETE FROM passage_queue');
    const response = await t.call('POST', '/v1/passages/reindex', {});
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      queued: 1,
      processed: 1,
      status: { queue: { pending: 0, done: 1, failed: 0 }, passages: 3, papers: 1 },
    });
    // The other project's paper was not queued by this project's reindex.
    expect(t.rows(OTHER)).toEqual([]);
    const status = await t.call('GET', '/v1/passages/status');
    expect(await status.json()).toEqual({
      queue: { pending: 0, done: 1, failed: 0 },
      passages: 3,
      papers: 1,
    });
  });

  it('reindexes a corpus and removes passages of papers that no longer exist', async () => {
    const t = setup();
    await t.put('papers', PAPER_A, paperA());
    await t.drain();
    // A paper removed from the store while the index missed it keeps rows until a reindex cleans them up.
    t.sqlite.exec("UPDATE doc SET deleted_at = '2026-11-25T00:00:00.000Z' WHERE collection = 'papers'");
    t.sqlite.exec('DELETE FROM passage_queue');
    const corpus = exampleCorpus();
    const [member] = corpus.members;
    if (!member) throw new Error('Missing synthetic member');
    corpus.members = [{ ...member, identifiers: { ...member.identifiers, paperIds: [PAPER_A] } }];
    await t.put('corpora', corpus.id, corpus);
    const response = await t.call('POST', '/v1/passages/reindex', { corpusId: corpus.id });
    expect(await response.json()).toMatchObject({ queued: 1, processed: 1 });
    expect(t.rows()).toEqual([]);
    expect(t.vectors.stored.size).toBe(0);
    expect((await t.call('POST', '/v1/passages/reindex', { corpusId: 'missing' })).status).toBe(404);
    expect((await t.call('POST', '/v1/passages/reindex', { paperIds: [] })).status).toBe(400);
  });
});

describe('fuseRankings', () => {
  it('sums reciprocal ranks across channels and records the sources', () => {
    const fused = fuseRankings([
      { source: 'vector', keys: ['a', 'b', 'c'] },
      { source: 'keyword', keys: ['c', 'd'] },
    ]);
    expect(fused.map(({ key }) => key)).toEqual(['c', 'a', 'b', 'd']);
    expect(fused[0]).toEqual({
      key: 'c',
      score: 1 / (RRF_K + 3) + 1 / (RRF_K + 1),
      sources: ['vector', 'keyword'],
    });
    expect(fused[1]?.score).toBeCloseTo(1 / (RRF_K + 1));
  });
});
