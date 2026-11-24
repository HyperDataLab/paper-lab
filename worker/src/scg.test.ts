import { describe, expect, it } from 'vitest';
import { exampleScgPaper } from '../../src/core/scg/contract';
import { scgBodyEtag } from '../../src/core/scg/publish';
import { examplePaperModel } from '../../src/core/paperModel/contract';
import { NotAllowedError } from './auth';
import { handle, type Bucket, type Deps } from './app';
import type { KgBindings } from './kg/bindings';
import { testDb } from './kg/testDb';

const id = `sha256-${'a'.repeat(64)}`;
const other = `sha256-${'b'.repeat(64)}`;
const PROJECT_ID = '00000000-0000-4000-8000-000000000101';
const modelKey = (paperId: string) => `paperlab/projects/${PROJECT_ID}/published/${paperId}/model.json`;
const scgKey = (paperId: string) => `paperlab/projects/${PROJECT_ID}/scg/${paperId}.json`;

function setup(kg?: KgBindings) {
  const objects = new Map<string, { body: ArrayBuffer; meta: Record<string, string> }>();
  const bucket: Bucket = {
    head: async (key) => {
      const item = objects.get(key);
      return item ? { etag: 'r2', customMetadata: item.meta } : null;
    },
    get: async (key) => {
      const item = objects.get(key);
      return item ? { body: new Blob([item.body]).stream(), size: item.body.byteLength, etag: 'r2' } : null;
    },
    list: async ({ prefix, cursor, limit = 1000 }) => {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const slice = keys.slice(start, start + limit);
      const truncated = start + limit < keys.length;
      return {
        objects: slice.map((key) => ({ key, etag: 'r2', customMetadata: objects.get(key)?.meta })),
        truncated,
        cursor: truncated ? String(start + limit) : undefined,
      };
    },
    put: async (key, body, options) => {
      objects.set(key, { body, meta: options.customMetadata });
      return { etag: 'r2' };
    },
  };
  let now = new Date('2026-11-18T00:00:00Z');
  const deps: Deps = {
    bucket,
    verifyToken: async (token) => {
      if (token === 'outsider') throw new NotAllowedError();
      if (token !== 'token') throw new Error('bad token');
      return { uid: '1', email: 'test@example.org', kind: 'sso' as const };
    },
    allowedOrigins: ['https://example.org'],
    getOwnedProject: async (projectId) => ({ id: projectId, name: 'Test project' }),
    now: () => now,
    kg,
  };
  const call = (method: string, path: string, body?: string, extra: Record<string, string> = {}) =>
    handle(
      deps,
      new Request(`https://worker.test${path}`, {
        method,
        headers: {
          authorization: 'Bearer token',
          origin: 'https://example.org',
          'X-Project-Id': PROJECT_ID,
          ...extra,
        },
        body,
      }),
    );
  const publishModel = (paperId: string) =>
    objects.set(modelKey(paperId), {
      body: new TextEncoder().encode(JSON.stringify(examplePaperModel())).buffer as ArrayBuffer,
      meta: { contentEtag: 'm'.repeat(64) },
    });
  return { call, objects, publishModel, tick: () => (now = new Date(now.getTime() + 1000)) };
}
const graph = (paperId = id) => ({ ...exampleScgPaper(), paperId });

describe('published contribution graphs', () => {
  it('projects published contributions and builds_on, and enqueues the DOI with only D1 bound', async () => {
    const { db, sqlite } = testDb();
    const { call, publishModel } = setup({ KG: db });
    publishModel(id);
    const path = `/v1/papers/${id}/scg`;
    const value = graph();
    expect((await call('PUT', path, JSON.stringify(value))).status).toBe(200);
    expect(await (await call('PUT', path, JSON.stringify(value))).json()).toMatchObject({ unchanged: true });
    expect(sqlite.prepare('SELECT id, depth, source FROM ingest_queue').all()).toEqual([
      { id: '10.5555/example.0', depth: 1, source: 'seed' },
    ]);
    expect(sqlite.prepare('SELECT count(*) AS count FROM contribution').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT relation, target_kind FROM builds_on').all()).toEqual(
      expect.arrayContaining([
        { relation: 'prerequisite', target_kind: 'prerequisite' },
        { relation: 'reference', target_kind: 'paper' },
      ]),
    );
    expect((await call('PUT', path, JSON.stringify({ ...value, contributions: [] }))).status).toBe(200);
    expect(sqlite.prepare('SELECT * FROM contribution').all()).toEqual([]);
    expect(sqlite.prepare('SELECT * FROM builds_on').all()).toEqual([]);
  });

  it('repairs a failed KG projection when the same SCG is published again', async () => {
    const { db, sqlite } = testDb();
    const bindings: KgBindings = {
      KG: {
        ...db,
        batch: async () => {
          throw new Error('D1 unavailable');
        },
      },
    };
    const { call, publishModel } = setup(bindings);
    publishModel(id);
    const path = `/v1/papers/${id}/scg`;
    const body = JSON.stringify(graph());
    expect((await call('PUT', path, body)).status).toBe(500);
    expect(await (await call('GET', path)).text()).toBe(body);
    bindings.KG = db;
    expect(await (await call('PUT', path, body)).json()).toMatchObject({ unchanged: true });
    expect(sqlite.prepare('SELECT count(*) AS count FROM contribution').get()).toEqual({ count: 2 });
  });
  it('requires a lab sign-in', async () => {
    const { call } = setup();
    const path = `/v1/papers/${id}/scg`;
    expect((await call('GET', path, undefined, { authorization: '' })).status).toBe(401);
    expect((await call('GET', path, undefined, { authorization: 'Bearer nope' })).status).toBe(401);
    const forbidden = await call('GET', '/v1/scg', undefined, { authorization: 'Bearer outsider' });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ error: 'forbidden' });
  });

  it('refuses a graph for a paper whose model is not published', async () => {
    const { call } = setup();
    const path = `/v1/papers/${id}/scg`;
    const put = await call('PUT', path, JSON.stringify(graph()));
    expect(put.status).toBe(404);
    expect(await put.json()).toMatchObject({ error: 'paper_not_published' });
    expect(await (await call('GET', path)).json()).toMatchObject({ error: 'paper_not_published' });
  });

  it('validates the body: shape, rejected items, path id, sentence keys and size', async () => {
    const { call, publishModel } = setup();
    publishModel(id);
    const path = `/v1/papers/${id}/scg`;
    const after404 = await call('GET', path);
    expect(after404.status).toBe(404);
    expect(await after404.json()).toMatchObject({ error: 'not_found' });
    expect((await call('PUT', path, '{')).status).toBe(400);
    const rejected = graph();
    rejected.contributions[0]!.review = 'rejected' as 'accepted';
    expect((await call('PUT', path, JSON.stringify(rejected))).status).toBe(400);
    expect((await call('PUT', path, JSON.stringify({ ...graph(), text: 'raw' }))).status).toBe(400);
    expect((await call('PUT', path, JSON.stringify(graph(other)))).status).toBe(400);
    const stale = graph();
    stale.contributions[0]!.sourceSentenceKeys = [`${'0'.repeat(16)}#9`];
    const conflict = await call('PUT', path, JSON.stringify(stale));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: 'conflict' });
    const big = JSON.stringify({ ...graph(), pad: 'x'.repeat(2 * 1024 * 1024) });
    expect((await call('PUT', path, big)).status).toBe(413);
  });

  it('stores, serves with a quoted ETag and 304, and overwrites with a new ETag', async () => {
    const { call, objects, publishModel, tick } = setup();
    publishModel(id);
    const path = `/v1/papers/${id}/scg`;
    const body = JSON.stringify(graph());
    const put = await call('PUT', path, body);
    expect(put.status).toBe(200);
    const first = (await put.json()) as { etag: string; unchanged: boolean; updatedAt: string };
    expect(first).toMatchObject({ paperId: id, unchanged: false });
    expect(first.etag).toBe(await scgBodyEtag(body));
    expect(objects.get(scgKey(id))?.meta).toMatchObject({
      contentEtag: first.etag,
      modelEtag: 'm'.repeat(64),
      contributions: '2',
      publishedBy: 'test@example.org',
    });
    tick();
    expect(await (await call('PUT', path, body)).json()).toMatchObject({
      unchanged: true,
      updatedAt: first.updatedAt,
    });

    const get = await call('GET', path);
    expect(get.headers.get('ETag')).toBe(`"${first.etag}"`);
    expect(await get.text()).toBe(body);
    expect((await call('GET', path, undefined, { 'if-none-match': `"${first.etag}"` })).status).toBe(304);
    expect((await call('GET', path, undefined, { 'if-none-match': `W/"${first.etag}"` })).status).toBe(304);

    const reviewed = graph();
    reviewed.contributions[1]!.review = 'accepted';
    const second = (await (await call('PUT', path, JSON.stringify(reviewed))).json()) as { etag: string };
    expect(second.etag).not.toBe(first.etag);
    expect((await call('GET', path, undefined, { 'if-none-match': `"${first.etag}"` })).status).toBe(200);
  });

  it('lists published graphs page by page', async () => {
    const { call, objects, publishModel } = setup();
    for (let index = 0; index < 101; index++) {
      const paperId = `sha256-${index.toString(16).padStart(64, '0')}`;
      objects.set(scgKey(paperId), {
        body: new ArrayBuffer(0),
        meta: { doi: '', s2CorpusId: '', contributions: '1', updatedAt: 'u', contentEtag: 'e' },
      });
    }
    publishModel(id);
    await call('PUT', `/v1/papers/${id}/scg`, JSON.stringify(graph()));
    const first = (await (await call('GET', '/v1/scg')).json()) as {
      items: unknown[];
      nextCursor: string | null;
    };
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).toBe('100');
    const second = (await (await call('GET', `/v1/scg?cursor=${first.nextCursor}`)).json()) as {
      items: { paperId: string; doi: string | null; contributions: number }[];
      nextCursor: string | null;
    };
    expect(second.nextCursor).toBeNull();
    expect(second.items.at(-1)).toMatchObject({
      paperId: id,
      doi: '10.5555/example.0',
      s2CorpusId: null,
      idBase: '00000000-0000-4000-8000-000000000001',
      contributions: 2,
    });
    expect((await call('PUT', '/v1/scg')).status).toBe(400);
  });
});
