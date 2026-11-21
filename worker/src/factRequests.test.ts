import { describe, expect, it } from 'vitest';
import { handle, type Bucket, type Deps } from './app';

const id = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000101';
const path = `/v1/papers/${id}/experiment-facts/requests`;
const model = {
  format: 'paperlab-paper-model',
  schemaVersion: 1,
  document: { metadata: { title: 'Invented study', doi: '10.1234/example' } },
  sentences: [],
};

function setup() {
  const objects = new Map<string, { body: ArrayBuffer; meta: Record<string, string>; etag: string }>();
  let revision = 0;
  const bucket: Bucket = {
    head: async (key) => {
      const item = objects.get(key);
      return item ? { etag: item.etag, customMetadata: item.meta } : null;
    },
    get: async (key) => {
      const item = objects.get(key);
      return item
        ? { body: new Blob([item.body]).stream(), size: item.body.byteLength, etag: item.etag }
        : null;
    },
    list: async ({ prefix }) => ({
      objects: [...objects]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, item]) => ({ key, etag: item.etag, customMetadata: item.meta })),
      truncated: false,
    }),
    put: async (key, body, options) => {
      const existing = objects.get(key);
      if (
        (options.onlyIf?.etagDoesNotMatch === '*' && existing) ||
        (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== existing?.etag)
      )
        return null;
      const etag = String(++revision);
      objects.set(key, { body, meta: options.customMetadata, etag });
      return { etag };
    },
  };
  const deps: Deps = {
    bucket,
    verifyToken: async (token) => ({ uid: token, email: token }),
    adminEmails: ['admin@example.org'],
    allowedOrigins: ['https://example.org'],
    getOwnedProject: async (requestedId) => ({ id: requestedId, name: 'Test project' }),
    now: () => new Date('2026-11-17T00:00:00Z'),
  };
  const call = (
    method: string,
    url: string,
    body?: unknown,
    admin = false,
    extra: Record<string, string> = {},
  ) =>
    handle(
      deps,
      new Request(`https://worker.test${url}`, {
        method,
        headers: {
          authorization: `Bearer ${admin ? 'admin@example.org' : 'user@example.org'}`,
          origin: 'https://example.org',
          ...(url === '/v1/me' ? {} : { 'X-Project-Id': projectId }),
          ...extra,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  return { call, objects };
}

describe('fact requests', () => {
  it('reports the authenticated admin role and protects admin endpoints', async () => {
    const { call } = setup();
    expect(await (await call('GET', '/v1/me')).json()).toEqual({ email: 'user@example.org', admin: false });
    expect(await (await call('GET', '/v1/me', undefined, true)).json()).toEqual({
      email: 'admin@example.org',
      admin: true,
    });
    expect((await call('GET', '/v1/admin/fact-requests')).status).toBe(403);
    expect(
      (await call('POST', `/v1/admin/fact-requests/${id}/decision`, { decision: 'approve' })).status,
    ).toBe(403);
  });
  it('creates, deduplicates, declines and replaces requests and lists their state', async () => {
    const { call } = setup();
    expect((await call('POST', path, {})).status).toBe(404);
    await call('PUT', `/v1/papers/${id}/model`, model);
    expect((await call('GET', path)).status).toBe(404);
    expect((await call('POST', path, { note: 'x'.repeat(1001) })).status).toBe(400);
    expect(await (await call('POST', path, { note: 'Please measure' })).json()).toEqual({
      requestId: id,
      state: 'requested',
    });
    expect(await (await call('POST', path, { note: 'ignored' })).json()).toMatchObject({
      state: 'requested',
      note: 'Please measure',
    });
    const get = await call('GET', path);
    expect(
      (await call('GET', path, undefined, false, { 'if-none-match': get.headers.get('etag') ?? '' })).status,
    ).toBe(304);
    expect(await (await call('GET', '/v1/papers')).json()).toMatchObject({
      items: [{ experimentFacts: 'none', factsRequest: 'requested' }],
    });
    expect(
      await (await call('GET', '/v1/admin/fact-requests?state=requested', undefined, true)).json(),
    ).toMatchObject({
      items: [{ paperId: id, title: 'Invented study', doi: '10.1234/example' }],
      nextCursor: null,
    });
    const decision = `/v1/admin/fact-requests/${id}/decision`;
    expect(
      await (await call('POST', decision, { decision: 'decline', note: 'Later' }, true)).json(),
    ).toMatchObject({ state: 'declined', decisionNote: 'Later', decidedBy: 'admin@example.org' });
    expect((await call('POST', decision, { decision: 'approve' }, true)).status).toBe(409);
    expect(await (await call('POST', path, {})).json()).toEqual({ requestId: id, state: 'requested' });
    expect(await (await call('POST', decision, { decision: 'approve' }, true)).json()).toMatchObject({
      state: 'approved',
    });
    expect(await (await call('POST', path, {})).json()).toMatchObject({ state: 'approved' });
  });
  it.each(['requested', 'approved'])(
    'marks %s requests done on facts publication and rejects new requests while facts exist',
    async (state) => {
      const { call, objects } = setup();
      const published = (await (await call('PUT', `/v1/papers/${id}/model`, model)).json()) as {
        etag: string;
      };
      await call('POST', path, {});
      if (state === 'approved')
        await call('POST', `/v1/admin/fact-requests/${id}/decision`, { decision: 'approve' }, true);
      const facts = {
        format: 'paperlab-experiment-facts',
        schemaVersion: 1,
        paperId: id,
        modelEtag: published.etag,
        facts: [],
      };
      expect((await call('PUT', `/v1/papers/${id}/experiment-facts`, facts)).status).toBe(200);
      expect(await (await call('GET', path)).json()).toMatchObject({ state: 'done' });
      expect((await call('POST', path, {})).status).toBe(409);
      objects.delete(`paperlab/projects/${projectId}/published/${id}/experiment-facts.json`);
      expect(await (await call('POST', path, {})).json()).toEqual({ requestId: id, state: 'requested' });
    },
  );
});
