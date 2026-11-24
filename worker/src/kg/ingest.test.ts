import { expect, it, vi } from 'vitest';
import { handle, type Deps } from '../app';
import { NotAllowedError } from '../auth';
import { configuredKg, EMBEDDING_MODEL, type KgBindings } from './bindings';
import { CRON_JOBS, drainKgQueue } from './ingest';
import { kgQueue } from './queue';
import { testDb } from './testDb';

const PROJECT_ID = '00000000-0000-4000-8000-000000000101';

function setup() {
  const { db, sqlite } = testDb();
  let clock = new Date('2026-06-01T00:00:00.000Z');
  const now = () => clock;
  const run = vi.fn(async () => ({ data: [Array.from({ length: 768 }, () => 0.5)] }));
  const upsert = vi.fn(async () => ({}));
  const bindings: KgBindings = {
    KG: db,
    KG_VECTORS: { upsert, query: async () => ({ matches: [] }) },
    AI: { run },
    OPENALEX_MAILTO: 'test@example.invalid',
    OPENALEX_API_KEY: 'synthetic-key',
  };
  const kg = configuredKg(bindings);
  if (!kg) throw new Error('Missing mock bindings');
  const fetcher = vi.fn<typeof fetch>();
  const deps: Deps = {
    bucket: {
      head: async () => null,
      get: async () => null,
      list: async () => ({ objects: [], truncated: false }),
      put: async () => null,
    },
    verifyToken: async (token) => {
      if (token !== 'lab') throw new NotAllowedError();
      return { uid: 'test', email: 'test@example.invalid', kind: 'sso' as const };
    },
    allowedOrigins: ['https://example.invalid'],
    getOwnedProject: async (id) => (id === PROJECT_ID ? { id, name: 'Test project' } : null),
    now,
    fetch: fetcher,
    kg: bindings,
  };
  const request = (body?: unknown, token = 'lab') =>
    handle(
      deps,
      new Request(`https://worker.test/v1/kg/ingest${body === undefined ? '/status' : ''}`, {
        method: body === undefined ? 'GET' : 'POST',
        body: JSON.stringify(body),
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'X-Project-Id': PROJECT_ID,
          Origin: 'https://example.invalid',
        },
      }),
    );
  const tick = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  return {
    request,
    bindings,
    fetcher,
    run,
    upsert,
    sqlite,
    tick,
    now,
    kg,
    queue: kgQueue(db, PROJECT_ID),
    drain: () => drainKgQueue(kg, { now, fetcher, projectId: PROJECT_ID }),
  };
}

it('authenticates lab accounts, validates identifiers, enum and limits, and requires all three bindings', async () => {
  const { request, fetcher, bindings } = setup();
  expect((await request({ ids: ['W1'] }, '')).status).toBe(401);
  expect((await request(undefined, 'outsider')).status).toBe(403);
  for (const body of [
    { ids: Array.from({ length: 51 }, () => 'W1') },
    { ids: [] },
    { ids: ['A1'] },
    { ids: ['W1'], depth: 3 },
    { ids: ['W1'], source: 'other' },
  ])
    expect((await request(body)).status).toBe(400);

  const { KG, KG_VECTORS, AI } = bindings;
  for (const missing of ['KG', 'KG_VECTORS', 'AI'] as const) {
    Object.assign(bindings, { KG, KG_VECTORS, AI, [missing]: undefined });
    for (const body of [undefined, { ids: ['W1'] }]) {
      const response = await request(body);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: 'kg_not_configured' });
    }
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it('queues 50 identifiers, processes one submitted seed immediately, and reports counts and logs', async () => {
  const { request, fetcher, run, upsert, sqlite } = setup();
  fetcher.mockResolvedValue(
    Response.json({
      id: 'W80',
      doi: 'https://doi.org/10.1000/synthetic',
      title: 'Synthetic paper',
      abstract_inverted_index: { Synthetic: [0], 'abstract.': [1] },
      publication_year: 2020,
      primary_topic: { id: 'T1', subfield: { id: 'subfields/30' } },
    }),
  );
  const ids = [
    'https://doi.org/10.1000/Synthetic',
    ...Array.from({ length: 49 }, (_, index) => `W${index + 100}`),
  ];
  const response = await request({ ids, depth: 0, source: 'sciatlas_pointer' });
  expect(response.status).toBe(202);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.invalid');
  expect(await response.json()).toEqual({ queued: 50, processed: 1, skipped: 0, errors: [] });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const url = new URL(String(fetcher.mock.calls[0]?.[0]));
  expect(decodeURIComponent(url.pathname)).toBe('/works/https://doi.org/10.1000/synthetic');
  expect(url.searchParams.get('select')?.split(',')).toContain('abstract_inverted_index');
  expect(url.searchParams.get('mailto')).toBe('test@example.invalid');
  expect(url.searchParams.get('api_key')).toBe('synthetic-key');
  expect(run).toHaveBeenCalledWith(EMBEDDING_MODEL, { text: ['Synthetic paper\n\nSynthetic abstract.'] });
  expect(upsert).toHaveBeenCalledWith([
    {
      id: `@rh/${PROJECT_ID}/W80`,
      values: expect.arrayContaining([0.5]),
      metadata: { year: 2020, subfieldId: 'subfields/30' },
    },
  ]);
  expect(
    sqlite
      .prepare('SELECT source, resolved_paper_id FROM ingest_queue WHERE id = ?')
      .get(`@rh/${PROJECT_ID}/10.1000/synthetic`),
  ).toEqual({
    source: 'sciatlas_pointer',
    resolved_paper_id: `@rh/${PROJECT_ID}/W80`,
  });
  expect(
    await (await request({ ids: ['doi:10.1000/Synthetic', '10.1000/synthetic'], depth: 0 })).json(),
  ).toEqual({ queued: 0, processed: 0, skipped: 2, errors: [] });
  expect(await (await request()).json()).toMatchObject({
    counts: { pending: 49, processing: 0, done: 1, failed: 0 },
    logs: [{ id: '10.1000/synthetic', code: 'ingested', attempts: 1, at: '2026-06-01T00:00:00.000Z' }],
  });
});

it('cron drains at most CRON_JOBS jobs per run', async () => {
  const { drain, queue, now, fetcher } = setup();
  fetcher.mockImplementation(async (input) =>
    Response.json({ id: new URL(String(input)).pathname.split('/').at(-1), title: 'Synthetic work' }),
  );
  const ids = Array.from({ length: CRON_JOBS + 2 }, (_, i) => `W${i + 1}`);
  await queue.enqueue(ids, 0, 'seed', now().toISOString());
  expect(await drain()).toEqual({ processed: CRON_JOBS, errors: [] });
  expect((await queue.status()).counts).toMatchObject({ pending: 2, done: CRON_JOBS });
  expect(await drain()).toEqual({ processed: 2, errors: [] });
});

it('a run with a limit stops at it and follows references and highly cited citing works only to the requested depth', async () => {
  const { queue, now, fetcher, kg } = setup();
  const drain = () => drainKgQueue(kg, { now, fetcher, limit: 3, projectId: PROJECT_ID });
  fetcher.mockImplementation(async (input) => {
    const url = new URL(String(input));
    const target = url.pathname.split('/').at(-1);
    if (target === 'works') {
      expect(url.searchParams.get('sort')).toBe('cited_by_count:desc');
      expect(url.searchParams.get('per-page')).toBe('10');
      const results = url.searchParams.get('filter') === 'cites:W1' ? [{ id: 'W3' }] : [];
      return Response.json({ results });
    }
    const references: Record<string, string[]> = { W1: ['W2'], W2: ['W4'], W4: ['W5'] };
    return Response.json({
      id: target,
      title: 'Synthetic work',
      referenced_works: references[target ?? ''] ?? [],
    });
  });
  await queue.enqueue(['W1'], 2, 'seed', now().toISOString());
  expect(await drain()).toEqual({ processed: 3, errors: [] });
  expect((await queue.status()).counts).toMatchObject({ pending: 1, done: 3 });
  expect(await drain()).toEqual({ processed: 1, errors: [] });
  const filters = fetcher.mock.calls.flatMap(
    ([input]) => new URL(String(input)).searchParams.get('filter') ?? [],
  );
  expect(filters.sort()).toEqual(['cites:W1', 'cites:W2', 'cites:W3']);
  expect(fetcher.mock.calls.some(([input]) => String(input).includes('/W5'))).toBe(false);
});

it('backs off on 429, respects Retry-After across jobs and stops retrying after five attempts', async () => {
  const { drain, queue, now, tick, fetcher, sqlite } = setup();
  fetcher.mockImplementation(
    async () => new Response(null, { status: 429, headers: { 'Retry-After': '120' } }),
  );
  await queue.enqueue(['W1'], 1, 'seed', now().toISOString());
  expect(await drain()).toEqual({ processed: 0, errors: [{ id: 'W1', code: 'openalex_rate_limited' }] });
  expect(sqlite.prepare('SELECT attempts, next_at FROM ingest_queue').get()).toEqual({
    attempts: 1,
    next_at: '2026-06-01T00:02:00.000Z',
  });
  await queue.enqueue(['W2'], 0, 'seed', now().toISOString());
  tick(119_000);
  expect(await drain()).toEqual({ processed: 0, errors: [] });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const later = new Date(now().getTime() + 86_400_000).toISOString();
  sqlite.prepare('UPDATE ingest_queue SET next_at = ? WHERE id = ?').run(later, `@rh/${PROJECT_ID}/W2`);
  for (let attempt = 2; attempt <= 5; attempt++) {
    tick(1_000_000);
    await drain();
  }
  tick(1_000_000);
  expect(await drain()).toEqual({ processed: 0, errors: [] });
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect((await queue.status()).counts).toMatchObject({ failed: 1, pending: 1 });
  expect(sqlite.prepare(`SELECT attempts FROM ingest_queue WHERE status = 'failed'`).get()).toEqual({
    attempts: 5,
  });
});

it('claims each row once and keeps a depth increase that arrives while a job is running', async () => {
  const { queue, now, sqlite } = setup();
  const at = now().toISOString();
  await queue.enqueue(['W1'], 0, 'expansion', at);
  const [job, duplicate] = await Promise.all([queue.claim(now()), queue.claim(now())]);
  expect(duplicate).toBeUndefined();
  if (!job) throw new Error('Job was not claimed');
  expect(job).toMatchObject({ depth: 0, attempts: 1 });
  expect(await queue.enqueue(['W1'], 2, 'seed', at)).toBe(1);
  sqlite
    .prepare('INSERT INTO paper (id, title, title_normalized) VALUES (?, ?, ?)')
    .run(`@rh/${PROJECT_ID}/W1`, '', '');
  await queue.finish(job, { at, status: 'done', paperId: 'W1', targets: [] });
  expect(await queue.claim(now())).toMatchObject({ depth: 2, attempts: 1 });
});
