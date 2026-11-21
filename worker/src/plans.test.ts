import { describe, expect, it } from 'vitest';
import { examplePlan } from '../../src/core/researchDesign/plan/examplePlan';
import { exportPackage } from '../../src/core/researchDesign/plan/exportPackage';
import { readZipStore } from '../../src/core/researchDesign/plan/zip';
import { handle, type Bucket, type Deps } from './app';

const id = '00000000-0000-4000-8000-000000000001';
const path = `/v1/projects/${id}/plans/1`;
function setup() {
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
    list: async ({ prefix }) => ({
      objects: [...objects]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, item]) => ({ key, etag: 'r2', customMetadata: item.meta })),
      truncated: false,
    }),
    put: async (key, body, options) => {
      if (options.onlyIf?.etagDoesNotMatch === '*' && objects.has(key)) return null;
      objects.set(key, { body, meta: options.customMetadata });
      return { etag: 'r2' };
    },
  };
  const deps: Deps = {
    bucket,
    verifyToken: async () => ({ uid: '1', email: 'lab@example.org' }),
    allowedOrigins: ['https://example.org'],
    getOwnedProject: async (projectId) => ({ id: projectId, name: 'Test project' }),
    now: () => new Date('2026-11-17T00:00:00Z'),
  };
  const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
    handle(
      deps,
      new Request(`https://worker.test${url}`, {
        method,
        headers: {
          authorization: 'Bearer token',
          origin: 'https://example.org',
          'X-Project-Id': id,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  return { call, objects };
}

describe('published frozen plans', () => {
  it('publishes, lists, reads, caches, and preserves immutable versions', async () => {
    const { call, objects } = setup();
    const plan = examplePlan();
    const published = await call('PUT', path, plan);
    expect(published.status).toBe(201);
    const { etag } = (await published.json()) as { etag: string };
    expect(objects.get(`paperlab/projects/${id}/plans/${id}/1.json`)?.meta).toMatchObject({
      contentEtag: etag,
      frozenAt: plan.frozenAt,
      frozenBy: plan.frozenBy,
      publishedBy: 'lab@example.org',
    });
    expect(await (await call('GET', '/v1/projects')).json()).toEqual({
      items: [
        {
          projectId: id,
          title: plan.title,
          updatedAt: '2026-11-17T00:00:00.000Z',
          publishedBy: 'lab@example.org',
          latestVersion: 1,
        },
      ],
      nextCursor: null,
    });
    expect(await (await call('GET', `/v1/projects/${id}/plans`)).json()).toEqual({
      versions: [{ version: 1, frozenAt: plan.frozenAt, frozenBy: plan.frozenBy, etag }],
    });
    const read = await call('GET', path);
    expect(read.headers.get('etag')).toBe(`"${etag}"`);
    expect(await read.json()).toEqual(plan);
    expect((await call('GET', path, undefined, { 'if-none-match': `"${etag}"` })).status).toBe(304);
    expect(await (await call('PUT', path, plan)).json()).toEqual({ unchanged: true });
    expect((await call('PUT', path, { ...plan, title: 'Changed' })).status).toBe(409);
    expect((await call('PUT', path, { ...plan, planVersion: 2 })).status).toBe(400);
    const invalid = await call('PUT', path, { ...plan, runMatrix: { ...plan.runMatrix, expectedRuns: 1 } });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ error: 'plan_invalid', issues: [{ rule: 'PP-03' }] });
    expect((await call('PUT', path, { ...plan, title: '' })).status).toBe(422);
    expect((await call('GET', `/v1/projects/${id}/plans/2`)).status).toBe(404);
    expect((await call('GET', '/v1/projects/00000000-0000-4000-8000-000000000002/plans')).status).toBe(404);
  });
  it('returns the same package and manifest as the browser builder', async () => {
    const { call } = setup();
    const plan = examplePlan();
    const published = (await (await call('PUT', path, plan)).json()) as { etag: string };
    const response = await call('GET', `${path}/package`);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('etag')).toBe(`"${published.etag}"`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes).toEqual((await exportPackage(plan)).bytes);
    expect(readZipStore(bytes).map((entry) => entry.path)).toEqual(['manifest.json', 'plan.json', 'plan.md']);
  });
});
