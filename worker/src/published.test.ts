import { generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { describe, expect, it } from 'vitest';
import { handle, type Bucket, type Deps } from './app';
import { verifyFirebaseToken } from './auth';

const id = `sha256-${'a'.repeat(64)}`;
const PROJECT_ID = '00000000-0000-4000-8000-000000000101';
const projectPublishedKey = (paperId: string, file: string) =>
  `paperlab/projects/${PROJECT_ID}/published/${paperId}/${file}`;
const model = {
  format: 'paperlab-paper-model',
  schemaVersion: 1,
  generatedAt: '2026-01-01',
  document: {
    metadata: { title: 'Synthetic study', doi: '10.1234/Example' },
    source: { sha256: `sha256:${'a'.repeat(64)}` },
  },
  sentences: [],
};
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
      objects.set(key, { body, meta: options.customMetadata });
      return { etag: 'r2' };
    },
  };
  const deps: Deps = {
    bucket,
    verifyToken: async () => ({ uid: '1', email: 'test@example.org', kind: 'sso' as const }),
    allowedOrigins: ['https://example.org'],
    getOwnedProject: async (projectId) => ({ id: projectId, name: 'Test project' }),
    now: () => new Date('2026-11-17T00:00:00Z'),
  };
  const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
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
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  return { call, objects };
}
describe('published models', () => {
  it('publishes and caches facts, tracks review status, and retains facts after a model changes', async () => {
    const { call, objects } = setup();
    const modelPath = `/v1/papers/${id}/model`;
    const path = `/v1/papers/${id}/experiment-facts`;
    const facts = {
      format: 'paperlab-experiment-facts',
      schemaVersion: 1,
      paperId: id,
      modelEtag: 'a'.repeat(64),
      generatedAt: '2026-01-01',
      facts: [{ status: 'candidate' }],
    };
    expect((await call('PUT', path, facts)).status).toBe(404);
    expect((await call('GET', path)).status).toBe(404);
    const published = (await (await call('PUT', modelPath, model)).json()) as { etag: string };
    expect((await call('PUT', path, facts)).status).toBe(409);
    for (const invalid of [
      { ...facts, paperId: 'wrong' },
      { ...facts, modelEtag: 'bad' },
      { ...facts, facts: {} },
      { ...facts, format: 'wrong' },
      { ...facts, schemaVersion: 2 },
    ])
      expect((await call('PUT', path, invalid)).status).toBe(400);
    const valid = { ...facts, modelEtag: published.etag };
    const first = (await (await call('PUT', path, valid)).json()) as { etag: string; updatedAt: string };
    expect(objects.get(projectPublishedKey(id, 'model.json'))?.meta).toMatchObject({
      experimentFacts: 'candidate',
      contentEtag: published.etag,
    });
    const response = await call('GET', path);
    expect(response.headers.get('etag')).toBe(`"${first.etag}"`);
    expect(await response.json()).toEqual(valid);
    expect((await call('GET', path, undefined, { 'if-none-match': `"${first.etag}"` })).status).toBe(304);
    expect(await (await call('PUT', path, { ...valid, generatedAt: 'later' })).json()).toMatchObject({
      unchanged: true,
      etag: first.etag,
      updatedAt: first.updatedAt,
    });
    await call('PUT', path, { ...valid, facts: [{ status: 'accepted' }] });
    expect(objects.get(projectPublishedKey(id, 'model.json'))?.meta.experimentFacts).toBe('reviewed');
    await call('PUT', modelPath, { ...model, sentences: ['changed'] });
    expect(objects.get(projectPublishedKey(id, 'model.json'))?.meta.experimentFacts).toBe('reviewed');
    expect(((await (await call('GET', path)).json()) as typeof valid).modelEtag).toBe(published.etag);
    expect((await call('PUT', path, valid)).status).toBe(409);
    expect(((await (await call('GET', '/v1/papers')).json()) as { items: unknown[] }).items).toHaveLength(1);
  });
  it('publishes, lists, reads, caches and preserves unchanged content', async () => {
    const { call, objects } = setup();
    const path = `/v1/papers/${id}/model`;
    const first = (await (await call('PUT', path, model)).json()) as {
      etag: string;
      updatedAt: string;
      unchanged: boolean;
    };
    expect(first.unchanged).toBe(false);
    expect(objects.get(projectPublishedKey(id, 'model.json'))?.meta).toMatchObject({
      title: 'Synthetic study',
      experimentFacts: 'none',
      schemaVersion: 'paper-model-v1',
    });
    const list = await (await call('GET', '/v1/papers')).json();
    expect(list).toMatchObject({
      items: [
        {
          paperId: id,
          doi: '10.1234/Example',
          sourceSha256: 'a'.repeat(64),
          publishedBy: 'test@example.org',
        },
      ],
      nextCursor: null,
    });
    const read = await call('GET', path);
    expect(read.headers.get('etag')).toBe(`"${first.etag}"`);
    expect(read.headers.get('access-control-expose-headers')).toContain('ETag');
    expect(await read.json()).toEqual(model);
    const cached = await call('GET', path, undefined, { 'if-none-match': `"${first.etag}"` });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
    expect(await (await call('PUT', path, { ...model, generatedAt: '2027-01-01' })).json()).toMatchObject({
      etag: first.etag,
      updatedAt: first.updatedAt,
      unchanged: true,
    });
    expect(await (await call('GET', path)).json()).toEqual(model);
  });
  it('rejects mismatched IDs and reports missing models', async () => {
    const { call } = setup();
    expect((await call('PUT', `/v1/papers/sha256-${'b'.repeat(64)}/model`, model)).status).toBe(400);
    const missing = await call('GET', `/v1/papers/${id}/model`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not_found', message: `Paper ${id} was not found.` });
  });
  it('filters DOI, source hash and update time', async () => {
    const { call } = setup();
    await call('PUT', `/v1/papers/${id}/model`, model);
    for (const query of [
      'doi=10.1234%2FEXAMPLE',
      `sourceSha256=${'a'.repeat(64)}`,
      'updatedSince=2026-01-01',
    ])
      expect(
        ((await (await call('GET', `/v1/papers?${query}`)).json()) as { items: unknown[] }).items,
      ).toHaveLength(1);
    for (const query of ['doi=other', `sourceSha256=${'b'.repeat(64)}`, 'updatedSince=2027-01-01'])
      expect(
        ((await (await call('GET', `/v1/papers?${query}`)).json()) as { items: unknown[] }).items,
      ).toHaveLength(0);
  });
  it('accepts only configured Firebase projects and matching issuer and audience', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwks: JWTVerifyGetKey = async () => publicKey;
    const token = (issuer: string, audience = issuer) =>
      new SignJWT({
        email: 'a@example.org',
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject('user')
        .setIssuer(`https://securetoken.google.com/${issuer}`)
        .setAudience(audience)
        .setExpirationTime('1h')
        .sign(privateKey);
    const verify = (jwt: string) => verifyFirebaseToken(jwt, jwks, ['project-a', 'project-b'], 'example.org');
    await expect(verify(await token('project-b'))).resolves.toMatchObject({ uid: 'user' });
    await expect(verify(await token('project-c'))).rejects.toThrow();
    await expect(verify(await token('project-a', 'project-b'))).rejects.toThrow();
  });
});
