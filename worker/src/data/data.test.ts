import { describe, expect, it } from 'vitest';
import { exampleCorpus } from '../../../src/core/corpus/contract';
import { handle, type Deps } from '../app';
import { NotAllowedError } from '../auth';
import type { D1Database, D1Statement } from '../kg/bindings';
import { testDb } from '../kg/testDb';
import { collectOrphanBodies, GC_MAX_AGE_MS } from './gc';
import { CORPUS_PREFIX } from './legacyCorpora';
import { bodyKey as makeBodyKey, projectRecordId, type DocRow } from './store';
import { memoryBucket } from './testBucket';

const START = new Date('2026-11-19T00:00:00.000Z');
const A = 'a@hyperdatalab.org';
const B = 'b@hyperdatalab.org';
const PAPER = '00000000-0000-4000-8000-000000000001';
const PAPER_2 = '00000000-0000-4000-8000-000000000002';
const ANALYSIS = '00000000-0000-4000-8000-0000000000a1';
const RH_PROJECT = '00000000-0000-4000-8000-000000000101';
const OTHER_PROJECT = '00000000-0000-4000-8000-000000000102';
const bodyKey = (collection: string, id: string, version: number) =>
  makeBodyKey(collection, projectRecordId(RH_PROJECT, id), version);

function setup(options: { data?: boolean; wrapDb?: (db: D1Database) => D1Database } = {}) {
  let clock = START;
  const now = () => clock;
  const { db, sqlite } = testDb('migrations-data');
  const { bucket, objects } = memoryBucket(now);
  const deps: Deps = {
    bucket,
    verifyToken: async (token) => {
      if (token === 'outsider') throw new NotAllowedError();
      if (token === 'lab') return { uid: 'a', email: A };
      if (token === 'lab-b') return { uid: 'b', email: B };
      throw new Error('bad token');
    },
    allowedOrigins: ['https://app.example'],
    adminEmails: [A],
    now,
    data: options.data === false ? undefined : (options.wrapDb?.(db) ?? db),
    getOwnedProject: async (projectId) => ({ id: projectId, name: projectId }),
  };
  const call = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    token: string | null = 'lab',
  ) =>
    handle(
      deps,
      new Request(`https://worker.example${path}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'X-Project-Id': headers['X-Project-Id'] ?? RH_PROJECT,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
  const row = (collection: string, id: string) =>
    sqlite.prepare('SELECT * FROM doc WHERE collection = ? AND id = ?').get(collection, projectRecordId(RH_PROJECT, id)) as
      DocRow | undefined;
  const count = (sql: string) => Number((sqlite.prepare(sql).get() as { n: number }).n);
  return {
    db,
    sqlite,
    objects,
    bucket,
    call,
    row,
    count,
    tick: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

const doiKeywords = (doi: string, extra = 0) => ({
  doi,
  fetchedAt: START.toISOString(),
  keywords: Array.from({ length: extra }, (_, index) => ({
    id: `keywords/k${index}`,
    name: `k${index}`,
    score: 0.5,
  })),
});
const corpusKeywords = (corpusId: string) => ({
  schemaVersion: 1,
  corpusId,
  computedAt: START.toISOString(),
  memberCount: 0,
  memberDigest: 'digest',
  papersWithKeywords: 0,
  papersByYear: {},
  papers: [],
  keywords: [],
  pairs: [],
});
const libraryItem = (id: string, doi: string, overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id,
  doi,
  addedAt: START.toISOString(),
  updatedAt: START.toISOString(),
  lookup: 'done',
  title: 'Asynchronous federated learning',
  authors: [],
  year: 2024,
  venue: null,
  access: 'unknown',
  oa_sources: [],
  arxiv_id: null,
  taxonomy: null,
  openalex_id: null,
  paper_id: null,
  file_matches_title: null,
  error: null,
  ...overrides,
});
const auditEvent = (id: string) => ({
  schemaVersion: 1,
  id,
  analysisId: ANALYSIS,
  issueId: null,
  at: START.toISOString(),
  actor: 'human',
  action: 'confirm',
  before: null,
  after: null,
  note: null,
});
const ngram = (paperId: string, digit: string) => ({ hash: `sha256:${digit.repeat(64)}`, paperId });
const path = (collection: string, id: string) => `/v1/data/${collection}/${encodeURIComponent(id)}`;

describe('/v1/data/admin/import-legacy-corpora', () => {
  const route = '/v1/data/admin/import-legacy-corpora';
  const putLegacy = (bucket: ReturnType<typeof memoryBucket>['bucket'], id: string, body: unknown) =>
    bucket.put(`${CORPUS_PREFIX}${id}`, new TextEncoder().encode(JSON.stringify(body)).buffer, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {},
    });

  it('requires a lab admin', async () => {
    const { call } = setup();
    expect((await call('POST', route, undefined, {}, 'lab-b')).status).toBe(403);
    expect((await call('POST', route, undefined, {}, null)).status).toBe(401);
  });

  it('imports through the corpus schema and commit, skips live rows and counts invalid bodies', async () => {
    const { call, bucket, row } = setup();
    const corpus = { ...exampleCorpus(), id: PAPER };
    const existing = { ...corpus, id: PAPER_2, title: 'Current title' };
    expect(
      (await call('PUT', path('corpora', existing.id), existing, { 'if-none-match': '*' }, 'lab-b')).status,
    ).toBe(201);
    await putLegacy(bucket, corpus.id, corpus);
    await putLegacy(bucket, existing.id, { ...existing, title: 'Legacy title' });
    await putLegacy(bucket, ANALYSIS, { id: ANALYSIS });

    const first = await call('POST', route);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ imported: 1, skipped: 1, failed: 1, cursor: null });
    expect(row('corpora', corpus.id)).toMatchObject({
      created_by: A,
      updated_by: A,
      version: 1,
      r2_key: bodyKey('corpora', corpus.id, 1),
    });
    expect(await (await call('GET', path('corpora', corpus.id))).json()).toEqual(corpus);
    expect(await (await call('GET', path('corpora', existing.id))).json()).toEqual(existing);
    expect(row('corpora', ANALYSIS)).toBeUndefined();
    expect(await (await call('POST', route)).json()).toEqual({
      imported: 0,
      skipped: 2,
      failed: 1,
      cursor: null,
    });
    expect(row('corpora', corpus.id)?.version).toBe(1);
  });

  it('returns a cursor for more legacy objects than fit in one call', async () => {
    const { call, bucket } = setup();
    for (let index = 0; index < 9; index++) await putLegacy(bucket, `invalid-${index}`, {});
    const first = (await (await call('POST', route)).json()) as { failed: number; cursor: string };
    expect(first.failed).toBe(8);
    expect(first.cursor).toEqual(expect.any(String));
    expect(
      await (await call('POST', `${route}?${new URLSearchParams({ cursor: first.cursor })}`)).json(),
    ).toEqual({ imported: 0, skipped: 0, failed: 1, cursor: null });
  });
});

describe('/v1/data/{col}/{id}', () => {
  it('isolates identical records by ResearchHub project and hides unassigned legacy IDs', async () => {
    const { call, sqlite } = setup();
    const doi = '10.1234/scope';
    const body = doiKeywords(doi);
    expect((await call('PUT', path('doiKeywords', doi), body, { 'if-none-match': '*' })).status).toBe(201);
    const other = await call('GET', path('doiKeywords', doi), undefined, { 'X-Project-Id': OTHER_PROJECT });
    expect(other.status).toBe(404);
    expect((await call('PUT', path('doiKeywords', doi), { ...body, fetchedAt: '2026-11-20T00:00:00.000Z' }, {
      'if-none-match': '*', 'X-Project-Id': OTHER_PROJECT,
    })).status).toBe(201);
    expect((await call('GET', path('doiKeywords', doi))).status).toBe(200);
    expect((await call('GET', path('doiKeywords', doi), undefined, { 'X-Project-Id': OTHER_PROJECT })).status).toBe(200);
    const unassignedDoi = '10.1234/unassigned';
    sqlite.prepare("INSERT INTO doc (collection,id,version,r2_key,body_json,size,sha256,created_by,created_at,updated_by,updated_at,deleted_at,lab_id,visibility,summary_json) VALUES ('doiKeywords', ?, 1, NULL, ?, 2, 'x', 'a', ?, 'a', ?, NULL, 'hyperdatalab', 'lab', '{}')")
      .run(unassignedDoi, JSON.stringify(doiKeywords(unassignedDoi)), START.toISOString(), START.toISOString());
    expect((await call('GET', path('doiKeywords', unassignedDoi))).status).toBe(404);
  });

  it('creates with If-None-Match: *, reads with an ETag and answers 304', async () => {
    const { call, row, objects } = setup();
    const doi = '10.1234/Example';
    const created = await call('PUT', path('doiKeywords', doi), doiKeywords(doi), { 'if-none-match': '*' });
    expect(created.status).toBe(201);
    expect(created.headers.get('etag')).toBe('"v1"');
    expect(await created.json()).toEqual({ version: 1 });

    const stored = row('doiKeywords', doi) as DocRow;
    expect(stored).toMatchObject({
      version: 1,
      r2_key: bodyKey('doiKeywords', doi, 1),
      body_json: null,
      created_by: A,
      updated_by: A,
      created_at: START.toISOString(),
      lab_id: 'hyperdatalab',
      visibility: 'lab',
      doi: '10.1234/example',
      deleted_at: null,
    });
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(objects.has(bodyKey('doiKeywords', doi, 1))).toBe(true);

    const read = await call('GET', path('doiKeywords', doi));
    expect(read.status).toBe(200);
    expect(read.headers.get('etag')).toBe('"v1"');
    expect(await read.json()).toEqual(doiKeywords(doi));
    expect((await call('GET', path('doiKeywords', doi), undefined, { 'if-none-match': '"v1"' })).status).toBe(
      304,
    );
    expect((await call('GET', path('doiKeywords', '10.1/none'))).status).toBe(404);
  });

  it('updates with If-Match, stamps the updater and keeps the creator', async () => {
    const { call, row, tick } = setup();
    const doi = '10.1/a';
    await call('PUT', path('doiKeywords', doi), doiKeywords(doi), { 'if-none-match': '*' });
    tick(1000);
    const updated = await call(
      'PUT',
      path('doiKeywords', doi),
      doiKeywords(doi, 2),
      { 'if-match': '"v1"' },
      'lab-b',
    );
    expect(updated.status).toBe(200);
    expect(updated.headers.get('etag')).toBe('"v2"');
    expect(row('doiKeywords', doi)).toMatchObject({
      version: 2,
      created_by: A,
      updated_by: B,
      created_at: START.toISOString(),
      updated_at: new Date(START.getTime() + 1000).toISOString(),
      r2_key: bodyKey('doiKeywords', doi, 2),
    });
    expect(
      ((await (await call('GET', path('doiKeywords', doi))).json()) as { keywords: unknown[] }).keywords,
    ).toHaveLength(2);
  });

  it('answers 409 with the server version on a stale If-Match or a second create', async () => {
    const { call, row } = setup();
    const doi = '10.1/b';
    await call('PUT', path('doiKeywords', doi), doiKeywords(doi), { 'if-none-match': '*' });
    await call('PUT', path('doiKeywords', doi), doiKeywords(doi, 1), { 'if-match': '"v1"' });
    const stale = await call('PUT', path('doiKeywords', doi), doiKeywords(doi, 3), { 'if-match': '"v1"' });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: 'version_conflict', serverVersion: 2 });
    const again = await call('PUT', path('doiKeywords', doi), doiKeywords(doi), { 'if-none-match': '*' });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ serverVersion: 2 });
    expect(row('doiKeywords', doi)?.version).toBe(2);
  });

  it('never shares a body key that another attempt uploaded, even with the same bytes', async () => {
    const { call, row, objects, bucket } = setup();
    const doi = '10.1/race';
    const text = JSON.stringify(doiKeywords(doi));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    // Left by a writer whose commit may still lose its D1 race and then delete it.
    await bucket.put(bodyKey('doiKeywords', doi, 1), new TextEncoder().encode(text).buffer, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { sha256 },
    });
    expect((await call('PUT', path('doiKeywords', doi), text, { 'if-none-match': '*' })).status).toBe(201);
    const key = row('doiKeywords', doi)?.r2_key as string;
    expect(key).toMatch(/^paperlab\/data\/doiKeywords\/%40rh%2F[0-9a-f-]{36}%2F10\.1%2Frace\/v1-[0-9a-f-]{36}\.json$/u);
    expect(objects.has(bodyKey('doiKeywords', doi, 1))).toBe(true);
    await bucket.delete(bodyKey('doiKeywords', doi, 1));
    expect(await (await call('GET', path('doiKeywords', doi))).json()).toEqual(doiKeywords(doi));
    expect(
      (await call('GET', path('doiKeywords', doi), undefined, { 'if-none-match': 'W/"v1"' })).status,
    ).toBe(304);
  });

  it('requires a precondition on writes', async () => {
    const { call } = setup();
    const doi = '10.1/c';
    expect((await call('PUT', path('doiKeywords', doi), doiKeywords(doi))).status).toBe(428);
    expect((await call('PUT', path('doiKeywords', doi), doiKeywords(doi), { 'if-match': 'v1' })).status).toBe(
      428,
    );
    expect((await call('DELETE', path('doiKeywords', doi))).status).toBe(428);
  });

  it('soft-deletes with If-Match, bumps the version and allows a later create', async () => {
    const { call, row, objects } = setup();
    const doi = '10.1/d';
    await call('PUT', path('doiKeywords', doi), doiKeywords(doi), { 'if-none-match': '*' });
    expect((await call('DELETE', path('doiKeywords', doi), undefined, { 'if-match': '"v2"' })).status).toBe(
      409,
    );
    const removed = await call(
      'DELETE',
      path('doiKeywords', doi),
      undefined,
      { 'if-match': '"v1"' },
      'lab-b',
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ version: 2 });
    expect(row('doiKeywords', doi)).toMatchObject({
      version: 2,
      deleted_at: START.toISOString(),
      updated_by: B,
      r2_key: null,
    });
    expect((await call('GET', path('doiKeywords', doi))).status).toBe(404);
    // The tombstone's version carries on, so the new body never reuses an older key.
    const recreated = await call('PUT', path('doiKeywords', doi), doiKeywords(doi), { 'if-none-match': '*' });
    expect(recreated.headers.get('etag')).toBe('"v3"');
    expect(row('doiKeywords', doi)).toMatchObject({ version: 3, deleted_at: null, created_by: A });
    expect(objects.has(bodyKey('doiKeywords', doi, 3))).toBe(true);
  });

  it('keeps inline collections in D1 and enforces one live library item per DOI', async () => {
    const { call, row, objects } = setup();
    const first = libraryItem(PAPER, '10.5555/Same');
    expect((await call('PUT', path('library', PAPER), first, { 'if-none-match': '*' })).status).toBe(201);
    expect(row('library', PAPER)).toMatchObject({
      r2_key: null,
      doi: '10.5555/same',
      status: 'done',
      title: first.title,
    });
    expect(JSON.parse(row('library', PAPER)?.body_json as string)).toEqual(first);
    expect([...objects.keys()]).toEqual([]);

    const duplicate = await call(
      'PUT',
      path('library', PAPER_2),
      libraryItem(PAPER_2, 'https://doi.org/10.5555/SAME'),
      {
        'if-none-match': '*',
      },
    );
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: 'unique_conflict' });
    expect(row('library', PAPER_2)).toBeUndefined();
    // Once the first is deleted the DOI is free again.
    await call('DELETE', path('library', PAPER), undefined, { 'if-match': '"v1"' });
    expect(
      (
        await call('PUT', path('library', PAPER_2), libraryItem(PAPER_2, '10.5555/same'), {
          'if-none-match': '*',
        })
      ).status,
    ).toBe(201);
  });

  it('rejects bodies that fail the schema, name another id, or exceed the cap', async () => {
    const { call, row } = setup();
    const invalid = await call(
      'PUT',
      path('doiKeywords', '10.1/e'),
      { doi: '10.1/e' },
      { 'if-none-match': '*' },
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: 'invalid_body' });
    expect(
      (await call('PUT', path('doiKeywords', '10.1/e'), 'not json', { 'if-none-match': '*' })).status,
    ).toBe(400);
    const mismatch = await call('PUT', path('doiKeywords', '10.1/e'), doiKeywords('10.1/other'), {
      'if-none-match': '*',
    });
    expect(await mismatch.json()).toMatchObject({ error: 'id_mismatch' });
    // reviewNgrams is inline, capped at 64 KiB.
    const big = { ...ngram(PAPER, 'a'), padding: 'x'.repeat(70 * 1024) };
    const tooLarge = await call('PUT', path('reviewNgrams', `${PAPER}:sha256:${'a'.repeat(64)}`), big, {
      'if-none-match': '*',
    });
    expect(tooLarge.status).toBe(413);
    expect((await call('PUT', path('nope', 'x'), {}, { 'if-none-match': '*' })).status).toBe(404);
    expect(row('doiKeywords', '10.1/e')).toBeUndefined();
  });
});

describe('POST /v1/data/query', () => {
  async function seed(call: ReturnType<typeof setup>['call'], tick: (ms: number) => void) {
    for (const [paperId, digit] of [
      [PAPER, 'a'],
      [PAPER, 'b'],
      [PAPER_2, 'c'],
    ] as const) {
      const body = ngram(paperId, digit);
      await call('PUT', path('reviewNgrams', `${paperId}:${body.hash}`), body, { 'if-none-match': '*' });
      tick(1000);
    }
  }

  it('filters on an index, orders, pages with a cursor and skips deleted rows', async () => {
    const { call, tick } = setup();
    await seed(call, tick);
    const query = (body: object) => call('POST', '/v1/data/query', { collection: 'reviewNgrams', ...body });
    const byPaper = (await (await query({ where: { paperId: PAPER } })).json()) as {
      items: { id: string; paperId: string }[];
    };
    expect(byPaper.items.map((item) => item.paperId)).toEqual([PAPER, PAPER]);

    const first = (await (await query({ limit: 2, desc: true })).json()) as {
      items: { id: string; updatedAt: string }[];
      nextCursor: string | null;
    };
    expect(first.items.map((item) => item.id)).toEqual([
      `${PAPER_2}:sha256:${'c'.repeat(64)}`,
      `${PAPER}:sha256:${'b'.repeat(64)}`,
    ]);
    const second = (await (await query({ limit: 2, desc: true, cursor: first.nextCursor })).json()) as {
      items: { id: string }[];
      nextCursor: string | null;
    };
    expect(second.items.map((item) => item.id)).toEqual([`${PAPER}:sha256:${'a'.repeat(64)}`]);
    expect(second.nextCursor).toBeNull();

    await call('DELETE', path('reviewNgrams', `${PAPER}:sha256:${'a'.repeat(64)}`), undefined, {
      'if-match': '"v1"',
    });
    const live = (await (await query({ where: { paperId: PAPER } })).json()) as { items: unknown[] };
    expect(live.items).toHaveLength(1);
    const all = (await (await query({ where: { paperId: PAPER }, includeDeleted: true })).json()) as {
      items: unknown[];
    };
    expect(all.items).toHaveLength(2);
  });

  it('returns summaries by default and bodies on request', async () => {
    const { call } = setup();
    await call('PUT', path('corpusKeywords', 'corpus-1'), corpusKeywords('corpus-1'), {
      'if-none-match': '*',
    });
    await call('PUT', path('corpusKeywords', 'corpus-2'), corpusKeywords('corpus-2'), {
      'if-none-match': '*',
    });
    const summary = (await (
      await call('POST', '/v1/data/query', { collection: 'corpusKeywords', where: { corpusId: 'corpus-2' } })
    ).json()) as { items: Record<string, unknown>[] };
    expect(summary.items).toHaveLength(1);
    expect(summary.items[0]).toMatchObject({
      id: 'corpus-2',
      version: 1,
      corpusId: 'corpus-2',
      createdBy: A,
      summary: { schemaVersion: 1, corpusId: 'corpus-2', memberCount: 0, memberDigest: 'digest' },
    });
    expect(summary.items[0]).not.toHaveProperty('body');
    const withBody = (await (
      await call('POST', '/v1/data/query', { collection: 'corpusKeywords', include: 'body', orderBy: 'id' })
    ).json()) as { items: { body: unknown }[] };
    expect(withBody.items.map((item) => item.body)).toEqual([
      corpusKeywords('corpus-1'),
      corpusKeywords('corpus-2'),
    ]);
  });

  it('queries each index column', async () => {
    const { call, sqlite } = setup();
    await call(
      'PUT',
      path('library', PAPER),
      libraryItem(PAPER, '10.1234/lib', { paper_id: PAPER_2, lookup: 'pending' }),
      {
        'if-none-match': '*',
      },
    );
    await call('POST', '/v1/data/commit', {
      ops: [],
      audit: [{ collection: 'auditEvents', id: PAPER, body: auditEvent(PAPER) }],
    });
    await call('PUT', path('doiKeywords', '10.1234/kw'), doiKeywords('10.1234/kw'), { 'if-none-match': '*' });
    // Collections whose fixtures are large (projects, papers, corpora) are seeded as rows: the query is column-generic.
    const insert = sqlite.prepare(
      `INSERT INTO doc (collection, id, version, size, sha256, created_by, created_at, updated_by, updated_at, lab_id,
        hub_project_id, project_id, kind, source_sha256) VALUES (?, ?, 1, 0, '', ?, ?, ?, ?, 'hyperdatalab', ?, ?, ?, ?)`,
    );
    const at = START.toISOString();
    insert.run('autoresearchRuns', projectRecordId(RH_PROJECT, 'run-1'), A, at, A, at, RH_PROJECT, 'project-1', null, null);
    insert.run('corpora', projectRecordId(RH_PROJECT, 'corpus-1'), A, at, A, at, RH_PROJECT, null, 'topic', null);
    insert.run('papers', projectRecordId(RH_PROJECT, 'paper-1'), A, at, A, at, RH_PROJECT, null, null, 'f'.repeat(64));
    const ids = async (collection: string, where: Record<string, string>) =>
      (
        (await (await call('POST', '/v1/data/query', { collection, where })).json()) as {
          items: { id: string }[];
        }
      ).items.map((item) => item.id);
    expect(await ids('library', { doi: '10.1234/lib' })).toEqual([PAPER]);
    expect(await ids('library', { paperId: PAPER_2 })).toEqual([PAPER]);
    expect(await ids('library', { status: 'pending' })).toEqual([PAPER]);
    expect(await ids('library', { title: 'Asynchronous federated learning' })).toEqual([PAPER]);
    expect(await ids('library', { status: 'done' })).toEqual([]);
    expect(await ids('auditEvents', { refId: ANALYSIS })).toEqual([PAPER]);
    expect(await ids('doiKeywords', { doi: '10.1234/kw' })).toEqual(['10.1234/kw']);
    expect(await ids('autoresearchRuns', { projectId: 'project-1' })).toEqual(['run-1']);
    expect(await ids('corpora', { kind: 'topic' })).toEqual(['corpus-1']);
    expect(await ids('papers', { sourceSha256: 'f'.repeat(64) })).toEqual(['paper-1']);
    expect(
      (await call('POST', '/v1/data/query', { collection: 'library', where: { email: 'x' } })).status,
    ).toBe(400);
    expect((await call('POST', '/v1/data/query', { collection: 'library', limit: 501 })).status).toBe(400);
  });
});

describe('POST /v1/data/batch-get', () => {
  it('batches mixed paper references, including the same id in more than one collection', async () => {
    const { call } = setup();
    const paper = {
      schemaVersion: 1,
      id: PAPER,
      title: 'Synthetic',
      createdAt: START.toISOString(),
      updatedAt: START.toISOString(),
      source: { kind: 'text', fileName: 'paper.txt', pageCount: null, sha256: 'test' },
      sections: [],
      paragraphs: [],
    };
    const context = {
      schemaVersion: 1,
      paperId: PAPER,
      checkedAt: START.toISOString(),
      paperDoi: null,
      checked: 0,
      found: 0,
      retracted: [],
    };
    expect((await call('PUT', `/v1/data/papers/${PAPER}`, paper, { 'if-none-match': '*' })).status).toBe(201);
    expect(
      (await call('PUT', `/v1/data/paperContext/${PAPER}`, context, { 'if-none-match': '*' })).status,
    ).toBe(201);
    const papers = Array.from({ length: 98 }, (_, i) => ({
      collection: 'papers',
      id: i ? `synthetic-${i}` : PAPER,
    }));
    const refs = [...papers, { collection: 'paperContext', id: PAPER }, { collection: 'stance', id: PAPER }];
    const response = await call('POST', '/v1/data/batch-get', { refs });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [
        { collection: 'papers', id: PAPER, body: paper },
        { collection: 'paperContext', id: PAPER, body: context },
      ],
      missing: [...papers.slice(1), { collection: 'stance', id: PAPER }],
      deferred: [],
    });
    expect((await call('POST', '/v1/data/batch-get', { refs: [...refs, refs[0]] })).status).toBe(400);
  });

  it('returns bodies for live ids and lists the missing ones', async () => {
    const { call } = setup();
    await call('PUT', path('doiKeywords', '10.1/x'), doiKeywords('10.1/x'), { 'if-none-match': '*' });
    await call('PUT', path('doiKeywords', '10.1/y'), doiKeywords('10.1/y'), { 'if-none-match': '*' });
    await call('DELETE', path('doiKeywords', '10.1/y'), undefined, { 'if-match': '"v1"' });
    const ids = ['10.1/x', '10.1/y', '10.1/z', ...Array.from({ length: 97 }, (_, index) => `10.1/n${index}`)];
    const response = await call('POST', '/v1/data/batch-get', { collection: 'doiKeywords', ids });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      items: { id: string; body: unknown }[];
      missing: string[];
      deferred: string[];
    };
    expect(result.items).toEqual([
      expect.objectContaining({ id: '10.1/x', version: 1, body: doiKeywords('10.1/x') }),
    ]);
    expect(result.missing).toHaveLength(99);
    expect(result.deferred).toEqual([]);
    const tooMany = [...ids, '10.1/over'];
    expect(
      (await call('POST', '/v1/data/batch-get', { collection: 'doiKeywords', ids: tooMany })).status,
    ).toBe(400);
  });
});

describe('POST /v1/data/commit', () => {
  it('applies puts, deletes and appends together and returns the new versions', async () => {
    const { call, row, count } = setup();
    await call('PUT', path('doiKeywords', '10.1/old'), doiKeywords('10.1/old'), { 'if-none-match': '*' });
    await call('PUT', path('corpusKeywords', 'corpus-1'), corpusKeywords('corpus-1'), {
      'if-none-match': '*',
    });
    const response = await call('POST', '/v1/data/commit', {
      ops: [
        {
          collection: 'doiKeywords',
          id: '10.1/new',
          expectedVersion: null,
          op: 'put',
          body: doiKeywords('10.1/new'),
        },
        { collection: 'doiKeywords', id: '10.1/old', expectedVersion: 1, op: 'delete' },
      ],
      guards: [{ collection: 'corpusKeywords', id: 'corpus-1', expectedVersion: 1 }],
      audit: [{ collection: 'auditEvents', id: PAPER, body: auditEvent(PAPER) }],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [
        { collection: 'doiKeywords', id: '10.1/new', version: 1 },
        { collection: 'doiKeywords', id: '10.1/old', version: 2 },
      ],
      appended: 1,
    });
    expect(row('doiKeywords', '10.1/old')?.deleted_at).not.toBeNull();
    expect(row('auditEvents', PAPER)).toMatchObject({ ref_id: ANALYSIS, r2_key: null, created_by: A });
    expect(count('SELECT COUNT(*) AS n FROM version_guard')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM change_log')).toBe(2 + 3);
    // An append that exists already is skipped, so retries are idempotent.
    const retry = await call('POST', '/v1/data/commit', {
      audit: [{ collection: 'auditEvents', id: PAPER, body: auditEvent(PAPER) }],
    });
    expect(await retry.json()).toEqual({ results: [], appended: 0 });
  });

  it('writes nothing and lists the conflicts when one guard is stale', async () => {
    const { call, row, objects, count } = setup();
    await call('PUT', path('corpusKeywords', 'corpus-1'), corpusKeywords('corpus-1'), {
      'if-none-match': '*',
    });
    await call('PUT', path('corpusKeywords', 'corpus-1'), corpusKeywords('corpus-1'), { 'if-match': '"v1"' });
    const before = objects.size;
    const response = await call('POST', '/v1/data/commit', {
      ops: [
        {
          collection: 'doiKeywords',
          id: '10.1/new',
          expectedVersion: null,
          op: 'put',
          body: doiKeywords('10.1/new'),
        },
      ],
      guards: [{ collection: 'corpusKeywords', id: 'corpus-1', expectedVersion: 1 }],
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'version_conflict',
      conflicts: [{ collection: 'corpusKeywords', id: 'corpus-1', expectedVersion: 1, serverVersion: 2 }],
    });
    expect(row('doiKeywords', '10.1/new')).toBeUndefined();
    expect(objects.size).toBe(before);
    expect(count('SELECT COUNT(*) AS n FROM change_log')).toBe(2);
  });

  it('rolls the whole D1 batch back when a record changes between the read and the batch', async () => {
    // The second batch is the commit itself: a concurrent writer bumps the guarded record just before it.
    let batches = 0;
    let bump: () => void = () => {};
    const ctx = setup({
      wrapDb: (db) => ({
        prepare: (sql) => db.prepare(sql),
        batch: <T>(statements: D1Statement[]) => {
          batches += 1;
          if (batches === 4) bump();
          return db.batch<T>(statements);
        },
      }),
    });
    const { call, row, objects, count, sqlite } = ctx;
    // Batches 1–2: read and write the guarded record.
    await call('PUT', path('corpusKeywords', 'corpus-1'), corpusKeywords('corpus-1'), {
      'if-none-match': '*',
    });
    bump = () =>
      sqlite.exec(`UPDATE doc SET version = 2 WHERE collection = 'corpusKeywords' AND id = '${projectRecordId(RH_PROJECT, 'corpus-1')}'`);
    // Batch 3 is the commit's read (sees v1); batch 4 is the write, which now meets v2.
    const response = await call('POST', '/v1/data/commit', {
      ops: [
        {
          collection: 'doiKeywords',
          id: '10.1/new',
          expectedVersion: null,
          op: 'put',
          body: doiKeywords('10.1/new'),
        },
        {
          collection: 'corpusKeywords',
          id: 'corpus-1',
          expectedVersion: 1,
          op: 'put',
          body: corpusKeywords('corpus-1'),
        },
      ],
      audit: [{ collection: 'auditEvents', id: PAPER, body: auditEvent(PAPER) }],
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      conflicts: [{ collection: 'corpusKeywords', id: 'corpus-1', expectedVersion: 1, serverVersion: 2 }],
    });
    // Neither the unrelated put nor the append landed, and the bodies uploaded for them were removed.
    expect(row('doiKeywords', '10.1/new')).toBeUndefined();
    expect(row('auditEvents', PAPER)).toBeUndefined();
    expect(count('SELECT COUNT(*) AS n FROM change_log')).toBe(1);
    expect([...objects.keys()]).toEqual([bodyKey('corpusKeywords', 'corpus-1', 1)]);
  });

  it('fails a batch on the version_conflict CHECK and undoes its earlier statements (the D1 contract)', async () => {
    const { db, sqlite } = setup();
    const statement = (sql: string, ...values: (string | number | null)[]) => db.prepare(sql).bind(...values);
    await expect(
      db.batch([
        statement(
          'INSERT INTO change_log (collection, id, version, op, actor, at) VALUES (?, ?, 1, ?, ?, ?)',
          'c',
          'x',
          'put',
          A,
          'now',
        ),
        statement(
          'INSERT INTO version_guard (ok) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM doc WHERE collection = ? AND id = ? AND version = ?)',
          'c',
          'x',
          7,
        ),
      ]),
    ).rejects.toThrow(/CHECK constraint failed: version_conflict/u);
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM change_log').get() as { n: number }).n).toBe(0);
    // A guard that holds inserts nothing, so the table stays empty.
    await db.batch([
      statement('INSERT INTO version_guard (ok) SELECT 0 WHERE EXISTS (SELECT 1 FROM doc WHERE id = ?)', 'x'),
    ]);
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM version_guard').get() as { n: number }).n).toBe(0);
  });

  it('keeps every statement within 100 bound parameters at the largest commit', async () => {
    const { call, count } = setup();
    const ops = Array.from({ length: 100 }, (_, index) => {
      const body = ngram(PAPER, index.toString(16).padStart(2, '0').slice(-1));
      const hash = `sha256:${index.toString(16).padStart(64, '0')}`;
      return {
        collection: 'reviewNgrams',
        id: `${PAPER}:${hash}`,
        expectedVersion: null,
        op: 'put',
        body: { ...body, hash },
      };
    });
    const audit = Array.from({ length: 200 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
      return { collection: 'auditEvents', id, body: auditEvent(id) };
    });
    const response = await call('POST', '/v1/data/commit', { ops, audit });
    expect(response.status).toBe(200);
    expect(count(`SELECT COUNT(*) AS n FROM doc`)).toBe(300);
    expect(count('SELECT COUNT(*) AS n FROM change_log')).toBe(300);
    expect((await call('POST', '/v1/data/commit', { ops: [...ops, ops[0]] })).status).toBe(400);
  });

  it('rejects invalid bodies, duplicates and non-inline appends before writing', async () => {
    const { call, objects, count } = setup();
    const bad = await call('POST', '/v1/data/commit', {
      ops: [
        {
          collection: 'doiKeywords',
          id: '10.1/a',
          expectedVersion: null,
          op: 'put',
          body: doiKeywords('10.1/a'),
        },
        { collection: 'doiKeywords', id: '10.1/b', expectedVersion: null, op: 'put', body: { doi: 1 } },
      ],
    });
    expect(bad.status).toBe(400);
    expect(objects.size).toBe(0);
    const twice = await call('POST', '/v1/data/commit', {
      ops: [
        {
          collection: 'doiKeywords',
          id: '10.1/a',
          expectedVersion: null,
          op: 'put',
          body: doiKeywords('10.1/a'),
        },
      ],
      guards: [{ collection: 'doiKeywords', id: '10.1/a', expectedVersion: null }],
    });
    expect(twice.status).toBe(400);
    const r2Append = await call('POST', '/v1/data/commit', {
      audit: [{ collection: 'doiKeywords', id: '10.1/a', body: doiKeywords('10.1/a') }],
    });
    expect(r2Append.status).toBe(400);
    expect(count('SELECT COUNT(*) AS n FROM doc')).toBe(0);
  });
});

describe('orphan body garbage collection', () => {
  it('removes bodies that are old enough or three versions behind, never the current one', async () => {
    const { call, objects, bucket, db, tick } = setup();
    const doi = '10.1/gc';
    await call('PUT', path('doiKeywords', doi), doiKeywords(doi), { 'if-none-match': '*' });
    for (let version = 1; version <= 4; version++)
      await call('PUT', path('doiKeywords', doi), doiKeywords(doi, version), { 'if-match': `"v${version}"` });
    // An orphan from a commit whose D1 batch failed, and one from a commit still in flight.
    await bucket.put(bodyKey('doiKeywords', '10.1/never', 1), new ArrayBuffer(2), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {},
    });
    await bucket.put(bodyKey('doiKeywords', doi, 6), new ArrayBuffer(2), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {},
    });
    const key = (version: number) => bodyKey('doiKeywords', doi, version);

    const first = await collectOrphanBodies(db, bucket, new Date(START.getTime() + 1000));
    expect(first).toMatchObject({ deleted: 2, done: true });
    expect([...objects.keys()].sort()).toEqual(
      [key(3), key(4), key(5), key(6), bodyKey('doiKeywords', '10.1/never', 1)].sort(),
    );

    tick(GC_MAX_AGE_MS + 1);
    await collectOrphanBodies(db, bucket, new Date(START.getTime() + GC_MAX_AGE_MS + 2000));
    expect([...objects.keys()]).toEqual([key(5)]);
    expect((await call('GET', path('doiKeywords', doi))).status).toBe(200);
  });

  it('continues from the saved listing cursor in the next run', async () => {
    const { bucket, db } = setup();
    // Keys the store did not write are never touched, so every run only moves the cursor.
    for (let index = 0; index < 600; index++)
      await bucket.put(`paperlab/data/notes/${index.toString().padStart(3, '0')}.txt`, new ArrayBuffer(1), {
        httpMetadata: { contentType: 'text/plain' },
        customMetadata: {},
      });
    const later = new Date(START.getTime() + GC_MAX_AGE_MS + 1);
    expect(await collectOrphanBodies(db, bucket, later)).toEqual({ scanned: 500, deleted: 0, done: false });
    expect(await collectOrphanBodies(db, bucket, later)).toEqual({ scanned: 100, deleted: 0, done: true });
    expect(await collectOrphanBodies(db, bucket, later)).toMatchObject({ scanned: 500 });
  });

  it('deletes at most 100 bodies per run and finishes over several runs', async () => {
    const { bucket, db, objects } = setup();
    for (let index = 0; index < 600; index++)
      await bucket.put(
        bodyKey('doiKeywords', `10.1/o${index.toString().padStart(3, '0')}`, 1),
        new ArrayBuffer(1),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {},
        },
      );
    const later = new Date(START.getTime() + GC_MAX_AGE_MS + 1);
    const runs = [];
    for (let run = 0; run < 7 && objects.size; run++) runs.push(await collectOrphanBodies(db, bucket, later));
    expect(objects.size).toBe(0);
    expect(runs.every((result) => result.deleted <= 100)).toBe(true);
  });
});

describe('/v1/data access', () => {
  it('answers 503 without the DATA binding', async () => {
    const { call } = setup({ data: false });
    const response = await call('GET', path('doiKeywords', '10.1/a'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'data_not_configured' });
  });

  it('requires a signed-in lab account', async () => {
    const { call } = setup();
    const anonymous = await call('GET', path('doiKeywords', '10.1/a'), undefined, {}, null);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: 'unauthenticated' });
    expect((await call('GET', path('doiKeywords', '10.1/a'), undefined, {}, 'outsider')).status).toBe(403);
    expect((await call('GET', path('doiKeywords', '10.1/a'), undefined, {}, 'forged')).status).toBe(401);
  });

  it('answers CORS preflight for DELETE', async () => {
    const { call } = setup();
    const response = await call(
      'OPTIONS',
      path('doiKeywords', '10.1/a'),
      undefined,
      { origin: 'https://app.example' },
      null,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toContain('DELETE');
  });
});
