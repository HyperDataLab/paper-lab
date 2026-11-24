// ADR 0008: two sign-ins (Firebase ID token or HyperDataLab SSO access token) and two scopes (lab or project).
// Tokens are synthetic: a locally generated RS256 key signs the Firebase tokens, and a fake userinfo answers SSO.
import { generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { mapOpenAlexWorkToKg } from '../../src/core/labKg';
import { handle, PREFIX, type Deps } from './app';
import {
  cachedSsoVerifier,
  dualVerifier,
  looksLikeFirebaseToken,
  NotAllowedError,
  SSO_CACHE_MS,
  verifyFirebaseToken,
} from './auth';
import { memoryBucket } from './data/testBucket';
import type { KgBindings } from './kg/bindings';
import { kgRepo } from './kg/repo';
import { testDb } from './kg/testDb';
import { r2Prefix, scopeLikes } from './scope';

const FIREBASE_PROJECT = 'hyperdatalab-paragraph-lab';
const PROJECT_ID = '00000000-0000-4000-8000-000000000101';
const EMAIL = 'x@hyperdatalab.org';
const NOW = new Date('2026-11-25T00:00:00.000Z');

const keys = await generateKeyPair('RS256');
const otherKeys = await generateKeyPair('RS256');
const jwks: JWTVerifyGetKey = async () => keys.publicKey;

function firebaseToken(options: { key?: CryptoKey; email?: string } = {}) {
  return new SignJWT({
    email: options.email ?? EMAIL,
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject('firebase-uid')
    .setIssuer(`https://securetoken.google.com/${FIREBASE_PROJECT}`)
    .setAudience(FIREBASE_PROJECT)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(options.key ?? keys.privateKey);
}

/** A fake SSO userinfo endpoint that knows one opaque access token. */
function userinfo() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe('https://sso.example/oauth/userinfo');
    const auth = new Headers(init?.headers).get('Authorization');
    if (auth !== 'Bearer sso-good') return new Response('{}', { status: 401 });
    return Response.json({ sub: 'sso-uid', email: EMAIL, email_verified: true });
  });
}

function work(id: string, title: string) {
  return mapOpenAlexWorkToKg({
    id,
    title,
    publication_year: 2024,
    cited_by_count: 1,
    abstract_inverted_index: null,
    referenced_works: [],
    keywords: [{ id: `keywords/${id.toLowerCase()}`, display_name: `keyword ${id}`, score: 0.5 }],
    authorships: [],
    primary_location: null,
    primary_topic: null,
  });
}

async function setup() {
  const fetcher = userinfo();
  const verifyToken = dualVerifier({
    firebase: (token) => verifyFirebaseToken(token, jwks, [FIREBASE_PROJECT], 'hyperdatalab.org'),
    sso: cachedSsoVerifier({ ssoBaseUrl: 'https://sso.example', domain: 'hyperdatalab.org', fetcher }),
  });
  const { db: data } = testDb('migrations-data');
  const { db: kgDb } = testDb();
  // One paper in the lab KG, another in the project's KG.
  await kgRepo(kgDb).upsertWork(work('W1', 'Lab paper on asynchronous federated learning'));
  await kgRepo(kgDb, PROJECT_ID).upsertWork(work('W2', 'Project paper on asynchronous federated learning'));
  const kg: KgBindings = {
    KG: kgDb,
    KG_VECTORS: { upsert: async () => ({}), query: async () => ({ matches: [] }) },
    AI: { run: async () => ({ data: [] }) },
  };
  const getOwnedProject = vi.fn(async (projectId: string) => ({ id: projectId, name: 'Synthetic project' }));
  const { bucket, objects } = memoryBucket(() => NOW);
  const deps: Deps = {
    verifyToken,
    bucket,
    allowedOrigins: ['https://app.example'],
    now: () => NOW,
    data,
    kg,
    getOwnedProject,
  };
  const call = (
    method: string,
    path: string,
    token: string,
    options: { project?: string; body?: unknown; raw?: ArrayBuffer; headers?: Record<string, string> } = {},
  ) =>
    handle(
      deps,
      new Request(`https://worker.example${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(options.project ? { 'X-Project-Id': options.project } : {}),
          ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
        body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      }),
    );
  return { call, fetcher, getOwnedProject, objects };
}

const doiKeywords = (doi: string) => ({ doi, fetchedAt: NOW.toISOString(), keywords: [] });
const docPath = (id: string) => `/v1/data/doiKeywords/${encodeURIComponent(id)}`;

describe('ADR 0008 token kinds', () => {
  it('routes JWT-shaped Firebase tokens to Firebase and everything else to SSO', async () => {
    expect(looksLikeFirebaseToken(await firebaseToken())).toBe(true);
    expect(looksLikeFirebaseToken('sso-good')).toBe(false);
    expect(looksLikeFirebaseToken('a.b.c')).toBe(false);
    const hs256 = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(`https://securetoken.google.com/${FIREBASE_PROJECT}`)
      .sign(new TextEncoder().encode('synthetic-secret'));
    expect(looksLikeFirebaseToken(hs256)).toBe(false);
  });

  it('a Firebase token signs in to lab scope', async () => {
    const { call, fetcher } = await setup();
    const me = await call('GET', '/v1/me', await firebaseToken());
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ email: EMAIL, admin: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('an SSO token signs in to lab scope', async () => {
    const { call, getOwnedProject } = await setup();
    const me = await call('GET', '/v1/me', 'sso-good');
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ email: EMAIL, admin: false });
    expect(getOwnedProject).not.toHaveBeenCalled();
  });

  it('an SSO token with a project id gets project scope after the ResearchHub check', async () => {
    const { call, getOwnedProject } = await setup();
    const me = await call('GET', '/v1/me', 'sso-good', { project: PROJECT_ID });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ project: { id: PROJECT_ID } });
    expect(getOwnedProject).toHaveBeenCalledWith(PROJECT_ID, 'sso-good');
  });

  it('a Firebase token with a project id is refused with 403, on every route and before ResearchHub', async () => {
    const { call, getOwnedProject } = await setup();
    const token = await firebaseToken();
    for (const path of ['/v1/me', '/v1/kg/stats', docPath('10.1/x'), `/pdfs/${'a'.repeat(64)}`]) {
      const response = await call('GET', path, token, { project: PROJECT_ID });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'project scope needs HyperDataLab SSO' });
    }
    const query = await call('GET', `/v1/me?projectId=${PROJECT_ID}`, token);
    expect(query.status).toBe(403);
    const workspace = await call('GET', `/v1/workspaces/${PROJECT_ID}`, token);
    expect(workspace.status).toBe(403);
    expect(getOwnedProject).not.toHaveBeenCalled();
  });

  it('rejects a bad token of each kind with 401, and an outside domain with 403', async () => {
    const { call, fetcher } = await setup();
    const forged = await firebaseToken({ key: otherKeys.privateKey });
    expect((await call('GET', '/v1/me', forged)).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await call('GET', '/v1/me', 'sso-revoked')).status).toBe(401);
    expect((await call('GET', '/v1/me', await firebaseToken({ email: 'x@gmail.com' }))).status).toBe(403);
  });

  it('caches an SSO identity for five minutes per token digest, and never caches a failure', async () => {
    let clock = 0;
    const fetcher = userinfo();
    const verify = cachedSsoVerifier({
      ssoBaseUrl: 'https://sso.example',
      domain: 'hyperdatalab.org',
      fetcher,
      now: () => clock,
    });
    expect(await verify('sso-good')).toEqual({ uid: 'sso-uid', email: EMAIL });
    clock += SSO_CACHE_MS - 1;
    expect(await verify('sso-good')).toEqual({ uid: 'sso-uid', email: EMAIL });
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock += 1;
    await verify('sso-good');
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(verify('sso-revoked')).rejects.toThrow();
    await expect(verify('sso-revoked')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(4);
    const outsider = vi.fn(async () =>
      Response.json({ sub: 'o', email: 'o@gmail.com', email_verified: true }),
    );
    const strict = cachedSsoVerifier({
      ssoBaseUrl: 'https://sso.example',
      domain: 'hyperdatalab.org',
      fetcher: outsider,
    });
    await expect(strict('t')).rejects.toBeInstanceOf(NotAllowedError);
  });
});

describe('ADR 0008 lab and project isolation', () => {
  it('keeps lab and project records apart in the central store, in both directions', async () => {
    const { call } = await setup();
    const lab = await firebaseToken();
    const put = (token: string, doi: string, project?: string) =>
      call('PUT', docPath(doi), token, {
        project,
        body: doiKeywords(doi),
        headers: { 'if-none-match': '*' },
      });
    expect((await put(lab, '10.1/lab')).status).toBe(201);
    expect((await put('sso-good', '10.1/project', PROJECT_ID)).status).toBe(201);
    // The same logical id exists separately in each scope.
    expect((await put('sso-good', '10.1/lab', PROJECT_ID)).status).toBe(201);

    const ids = async (token: string, project?: string) => {
      const response = await call('POST', '/v1/data/query', token, {
        project,
        body: { collection: 'doiKeywords', orderBy: 'id' },
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { items: { id: string }[] }).items.map(({ id }) => id);
    };
    expect(await ids(lab)).toEqual(['10.1/lab']);
    expect(await ids('sso-good')).toEqual(['10.1/lab']);
    expect(await ids('sso-good', PROJECT_ID)).toEqual(['10.1/lab', '10.1/project']);

    expect((await call('GET', docPath('10.1/project'), lab)).status).toBe(204);
    expect((await call('GET', docPath('10.1/project'), 'sso-good', { project: PROJECT_ID })).status).toBe(
      200,
    );
    // A lab caller cannot name a project row by its physical id.
    expect((await call('GET', docPath(`@rh/${PROJECT_ID}/10.1/project`), lab)).status).toBe(400);
    const batch = await call('POST', '/v1/data/batch-get', lab, {
      body: { collection: 'doiKeywords', ids: ['10.1/lab', '10.1/project'] },
    });
    expect(await batch.json()).toMatchObject({ items: [{ id: '10.1/lab' }], missing: ['10.1/project'] });
  });

  it('keeps lab and project rows apart in the lab KG, in both directions', async () => {
    const { call } = await setup();
    const lab = await firebaseToken();
    const overview = async (token: string, project?: string) => {
      const response = await call('GET', '/v1/kg/overview', token, { project });
      return ((await response.json()) as { papers: { id: string }[] }).papers.map(({ id }) => id);
    };
    expect(await overview(lab)).toEqual(['W1']);
    expect(await overview('sso-good', PROJECT_ID)).toEqual(['W2']);

    const stats = async (token: string, project?: string) =>
      ((await (await call('GET', '/v1/kg/stats', token, { project })).json()) as { nodes: { paper: number } })
        .nodes.paper;
    expect(await stats(lab)).toBe(1);
    expect(await stats('sso-good', PROJECT_ID)).toBe(1);

    expect((await call('GET', '/v1/kg/papers/W1', lab)).status).toBe(200);
    expect((await call('GET', '/v1/kg/papers/W2', lab)).status).toBe(404);
    expect((await call('GET', '/v1/kg/papers/W1', 'sso-good', { project: PROJECT_ID })).status).toBe(404);
    expect((await call('GET', '/v1/kg/papers/W2', 'sso-good', { project: PROJECT_ID })).status).toBe(200);
    expect((await call('GET', '/v1/kg/keywords/keywords%2Fw2', lab)).status).toBe(404);
    expect((await call('GET', '/v1/kg/keywords/keywords%2Fw1', lab)).status).toBe(200);

    const sql = async (token: string, project?: string) => {
      const response = await call('POST', '/v1/kg/sql', token, {
        project,
        body: { sql: 'SELECT id FROM paper ORDER BY id', limit: 10 },
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { rows: unknown[][] }).rows.flat();
    };
    expect(await sql(lab)).toEqual(['W1']);
    expect(await sql('sso-good', PROJECT_ID)).toEqual([`@rh/${PROJECT_ID}/W2`]);

    const status = await call('GET', '/v1/kg/ingest/status', lab);
    expect(status.status).toBe(200);
  });

  it('keeps lab PDFs in the lab R2 store, out of project scope', async () => {
    const { call, objects } = await setup();
    const lab = await firebaseToken();
    const pdf = new TextEncoder().encode('%PDF-1.7 synthetic').buffer;
    const digest = await crypto.subtle.digest('SHA-256', pdf);
    const sha = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    expect((await call('HEAD', `/pdfs/${sha}`, lab)).status).toBe(404);
    const put = await call('PUT', `/pdfs/${sha}`, lab, {
      raw: pdf,
      headers: { 'content-type': 'application/pdf', 'content-length': String(pdf.byteLength) },
    });
    expect(put.status).toBe(201);
    expect(objects.get(`${PREFIX}${sha}.pdf`)?.customMetadata.uploadedBy).toBe(EMAIL);
    expect((await call('HEAD', `/pdfs/${sha}`, lab)).status).toBe(200);
    const got = await call('GET', `/pdfs/${sha}`, 'sso-good');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(new Uint8Array(pdf));
    // An unassigned lab PDF never shows up in a project.
    expect((await call('HEAD', `/pdfs/${sha}`, 'sso-good', { project: PROJECT_ID })).status).toBe(404);
  });

  it('uses the legacy R2 prefixes in lab scope and the project prefixes in project scope', () => {
    expect(r2Prefix(null, 'published')).toBe('paperlab/published/');
    expect(r2Prefix(undefined, 'fact-requests')).toBe('paperlab/fact-requests/');
    expect(r2Prefix(PROJECT_ID, 'plans')).toBe(`paperlab/projects/${PROJECT_ID}/plans/`);
    const sql = 'SELECT id FROM paper WHERE id LIKE ?2 AND x = ?1';
    expect(scopeLikes(PROJECT_ID, sql)).toBe(sql);
    expect(scopeLikes(null, sql)).toBe(
      "SELECT id FROM paper WHERE (id NOT LIKE '@rh/%' AND ?2 IS NULL) AND x = ?1",
    );
  });
});
