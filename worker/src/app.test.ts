import { generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { describe, expect, it } from 'vitest';
import { handle, MAX_BYTES, PREFIX, type Bucket, type Deps } from './app';
import { emailAllowed, NotAllowedError, verifyFirebaseToken } from './auth';

const ORIGIN = 'https://hyperdatalab-paragraph-lab.web.app';
const pdf = new TextEncoder().encode('%PDF-1.7 test file').buffer;
async function hex(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function memoryBucket() {
  const objects = new Map<string, { data: ArrayBuffer; meta: Record<string, string>; etag: string }>();
  let version = 0;
  const bucket: Bucket = {
    head: async (key) => {
      const object = objects.get(key);
      return object ? { etag: object.etag, customMetadata: object.meta } : null;
    },
    get: async (key) => {
      const object = objects.get(key);
      return object
        ? { body: new Blob([object.data]).stream(), size: object.data.byteLength, etag: object.etag }
        : null;
    },
    list: async ({ prefix }) => ({
      objects: [...objects]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, object]) => ({ key, etag: object.etag, customMetadata: object.meta })),
      truncated: false,
    }),
    put: async (key, value, options) => {
      const current = objects.get(key);
      if (
        (options.onlyIf?.etagDoesNotMatch === '*' && current) ||
        (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== current?.etag)
      )
        return null;
      const etag = String(++version);
      objects.set(key, { data: value, meta: options.customMetadata, etag });
      return { etag };
    },
  };
  return { bucket, objects };
}
function deps(overrides: Partial<Deps> = {}): Deps & { objects: Map<string, unknown> } {
  const { bucket, objects } = memoryBucket();
  return {
    verifyToken: async () => ({ uid: 'u1', email: 'a@hyperdatalab.org' }),
    bucket,
    allowedOrigins: [ORIGIN],
    now: () => new Date('2026-11-11T00:00:00.000Z'),
    objects,
    ...overrides,
  };
}
const request = (
  method: string,
  path: string,
  init: { body?: ArrayBuffer; headers?: Record<string, string> } = {},
) =>
  new Request(`https://worker.test${path}`, {
    method,
    body: init.body,
    headers: { origin: ORIGIN, authorization: 'Bearer good', ...init.headers },
  });
const put = (sha: string, body: ArrayBuffer, headers: Record<string, string> = {}) =>
  request('PUT', `/pdfs/${sha}`, {
    body,
    headers: { 'content-type': 'application/pdf', 'content-length': String(body.byteLength), ...headers },
  });

describe('R8 PDF worker', () => {
  it('stores a PDF under its hash once, records who sent it, and serves it back', async () => {
    const d = deps();
    const sha = await hex(pdf);
    const first = await handle(d, put(sha, pdf));
    expect(first.status).toBe(201);
    expect(first.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(d.objects.get(`${PREFIX}${sha}.pdf`)).toMatchObject({
      meta: { uploadedBy: 'a@hyperdatalab.org', uploadedAt: '2026-11-11T00:00:00.000Z' },
    });
    expect((await handle(d, put(sha, pdf))).status).toBe(200);
    expect((await handle(d, request('HEAD', `/pdfs/${sha}`))).status).toBe(200);
    const got = await handle(d, request('GET', `/pdfs/${sha}`));
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(new Uint8Array(pdf));
  });

  it('refuses a file whose content does not match its name, a non-PDF, a wrong type and a large file', async () => {
    const d = deps();
    const sha = await hex(pdf);
    expect((await handle(d, put('0'.repeat(64), pdf))).status).toBe(422);
    const text = new TextEncoder().encode('hello').buffer;
    expect((await handle(d, put(await hex(text), text))).status).toBe(400);
    expect((await handle(d, put(sha, pdf, { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await handle(d, put(sha, pdf, { 'content-length': String(MAX_BYTES + 1) }))).status).toBe(413);
    expect(d.objects.size).toBe(0);
  });

  it('answers 404 for what is not stored and 400 for a malformed name', async () => {
    const d = deps();
    expect((await handle(d, request('HEAD', `/pdfs/${'a'.repeat(64)}`))).status).toBe(404);
    expect((await handle(d, request('GET', `/pdfs/${'a'.repeat(64)}`))).status).toBe(404);
    expect((await handle(d, request('GET', '/pdfs/../secret'))).status).toBe(400);
    expect((await handle(d, request('GET', `/pdfs/${'A'.repeat(64)}`))).status).toBe(400);
  });

  it('needs a valid token from the lab domain: 401 without one, 403 from another domain', async () => {
    const sha = await hex(pdf);
    const anonymous = new Request(`https://worker.test/pdfs/${sha}`, {
      method: 'GET',
      headers: { origin: ORIGIN },
    });
    expect((await handle(deps(), anonymous)).status).toBe(401);
    const bad = deps({
      verifyToken: async () => {
        throw new Error('bad signature');
      },
    });
    expect((await handle(bad, request('GET', `/pdfs/${sha}`))).status).toBe(401);
    const outsider = deps({
      verifyToken: async () => {
        throw new NotAllowedError('domain');
      },
    });
    expect((await handle(outsider, request('GET', `/pdfs/${sha}`))).status).toBe(403);
  });

  it('answers the CORS preflight only for the app origins', async () => {
    const allowed = await handle(
      deps(),
      new Request('https://worker.test/pdfs/x', { method: 'OPTIONS', headers: { origin: ORIGIN } }),
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-methods')).toBe('GET, HEAD, PUT');
    const other = await handle(
      deps(),
      new Request('https://worker.test/pdfs/x', {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('C1d corpus worker', () => {
  it('authenticates, creates, lists and rejects stale updates', async () => {
    const d = deps();
    const id = '00000000-0000-4000-8000-000000000001';
    const path = `/corpora/${id}`;
    const body = new TextEncoder().encode(
      JSON.stringify({
        format: 'paperlab-corpus',
        schemaVersion: 1,
        id,
        title: 'A',
        kind: 'topic',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).buffer;
    expect((await handle(d, new Request(`https://worker.test${path}`))).status).toBe(401);
    expect(
      (
        await handle(
          deps({
            verifyToken: async () => {
              throw new NotAllowedError('domain');
            },
          }),
          request('GET', path),
        )
      ).status,
    ).toBe(403);
    const first = await handle(d, request('PUT', path, { body, headers: { 'if-none-match': '*' } }));
    expect(first.status).toBe(201);
    const initial = ((await first.json()) as { version: string }).version;
    expect(await handle(d, request('GET', '/corpora')).then((r) => r.json())).toMatchObject([
      { id, title: 'A', version: initial },
    ]);
    expect((await handle(d, request('GET', path))).status).toBe(200);
    const update = await handle(d, request('PUT', path, { body, headers: { 'if-match': initial } }));
    expect(update.status).toBe(200);
    const current = ((await update.json()) as { version: string }).version;
    const stale = await handle(d, request('PUT', path, { body, headers: { 'if-match': initial } }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ version: current });
  });
});

describe('R8 token rules', () => {
  it.each([
    'x@hyperdatalab.org.evil.com',
    'x@sub.hyperdatalab.org',
    'x@evilhyperdatalab.org',
    'a@b@hyperdatalab.org',
    'x@gmail.com',
    42,
  ])('rejects %s', (email) => expect(emailAllowed(email, 'hyperdatalab.org')).toBe(false));
  it('accepts the lab domain in any case', () => {
    expect(emailAllowed('x@hyperdatalab.org', 'hyperdatalab.org')).toBe(true);
    expect(emailAllowed('x@HyperDataLab.org', 'hyperdatalab.org')).toBe(true);
  });

  it('verifies signature, project, expiry, verified Google account and domain', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const other = await generateKeyPair('RS256');
    const jwks: JWTVerifyGetKey = async () => publicKey;
    const project = 'hyperdatalab-paragraph-lab';
    const claims = {
      email: 'x@hyperdatalab.org',
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    };
    const sign = (
      body: Record<string, unknown> = claims,
      options: { key?: CryptoKey; aud?: string; iss?: string; exp?: number } = {},
    ) =>
      new SignJWT(body)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setSubject('u1')
        .setIssuer(options.iss ?? `https://securetoken.google.com/${project}`)
        .setAudience(options.aud ?? project)
        .setIssuedAt()
        .setExpirationTime(options.exp ?? '1h')
        .sign(options.key ?? privateKey);
    const verify = (token: string) => verifyFirebaseToken(token, jwks, project, 'hyperdatalab.org');
    await expect(verify(await sign())).resolves.toEqual({ uid: 'u1', email: 'x@hyperdatalab.org' });
    await expect(verify(await sign(claims, { key: other.privateKey }))).rejects.toThrow();
    await expect(verify(await sign(claims, { aud: 'hyperlab-paper-fetch' }))).rejects.toThrow();
    await expect(
      verify(await sign(claims, { iss: 'https://securetoken.google.com/other' })),
    ).rejects.toThrow();
    await expect(verify(await sign(claims, { exp: 946684800 }))).rejects.toThrow();
    await expect(verify(await sign({ ...claims, email_verified: false }))).rejects.not.toBeInstanceOf(
      NotAllowedError,
    );
    await expect(
      verify(await sign({ ...claims, firebase: { sign_in_provider: 'password' } })),
    ).rejects.toThrow();
    await expect(verify(await sign({ ...claims, email: 'x@gmail.com' }))).rejects.toBeInstanceOf(
      NotAllowedError,
    );
  });
});
