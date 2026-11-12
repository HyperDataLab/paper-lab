import { NotAllowedError } from './auth';

/** The part of an R2 bucket this worker uses, so the logic runs in tests without Cloudflare. */
export interface Bucket {
  head(key: string): Promise<{ etag: string; customMetadata?: Record<string, string> } | null>;
  get(key: string): Promise<{ body: ReadableStream; size: number; etag: string } | null>;
  list(options: { prefix: string; cursor?: string; include: ['customMetadata'] }): Promise<{
    objects: { key: string; etag: string; customMetadata?: Record<string, string> }[];
    truncated: boolean;
    cursor?: string;
  }>;
  put(
    key: string,
    value: ArrayBuffer,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
      onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string };
    },
  ): Promise<{ etag: string } | null>;
}
export interface Deps {
  verifyToken: (token: string) => Promise<{ uid: string; email: string }>;
  bucket: Bucket;
  allowedOrigins: string[];
  now: () => Date;
}

export const MAX_BYTES = 25 * 1024 * 1024;
export const PREFIX = 'paperlab/pdfs/';
const SHA = /^\/pdfs\/([0-9a-f]{64})$/;
const CORPUS = /^\/corpora\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const CORPUS_PREFIX = 'paperlab/corpora/';

function cors(request: Request, deps: Deps): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin || !deps.allowedOrigins.includes(origin)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, PUT',
    'Access-Control-Allow-Headers': 'authorization, content-type, if-match, if-none-match',
    'Access-Control-Max-Age': '3600',
    Vary: 'Origin',
  };
}
const json = (status: number, body: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

async function sha256Hex(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Stores and serves the lab's original PDFs, one object per file named by its SHA-256. Only signed-in
 * members of the lab's domain may read or write; a file is checked against its name before it is stored.
 */
export async function handle(deps: Deps, request: Request): Promise<Response> {
  const headers = cors(request, deps);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const path = new URL(request.url).pathname;
  const match = SHA.exec(path);
  const corpusMatch = CORPUS.exec(path);
  if (!match && !corpusMatch && path !== '/corpora') return json(400, { error: 'invalid path' }, headers);

  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return json(401, { error: 'sign-in required' }, headers);
  let caller: { uid: string; email: string };
  try {
    caller = await deps.verifyToken(token);
  } catch (cause) {
    return cause instanceof NotAllowedError
      ? json(403, { error: 'account not allowed' }, headers)
      : json(401, { error: 'invalid token' }, headers);
  }

  if (path === '/corpora' || corpusMatch) {
    if (path === '/corpora') {
      if (request.method !== 'GET') return json(405, { error: 'method not allowed' }, headers);
      const items = [];
      let cursor: string | undefined;
      do {
        const page = await deps.bucket.list({ prefix: CORPUS_PREFIX, cursor, include: ['customMetadata'] });
        items.push(
          ...page.objects.map((object) => ({
            id: object.key.slice(CORPUS_PREFIX.length),
            title: object.customMetadata?.title,
            kind: object.customMetadata?.kind,
            updatedAt: object.customMetadata?.updatedAt,
            version: object.etag,
          })),
        );
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return json(200, items, headers);
    }
    const id = corpusMatch?.[1] as string;
    const key = `${CORPUS_PREFIX}${id}`;
    if (request.method === 'GET') {
      const object = await deps.bucket.get(key);
      if (!object) return json(404, { error: 'not stored' }, headers);
      return json(
        200,
        { corpus: JSON.parse(await new Response(object.body).text()), version: object.etag },
        headers,
      );
    }
    if (request.method !== 'PUT') return json(405, { error: 'method not allowed' }, headers);
    const expected = request.headers.get('if-match');
    const create = request.headers.get('if-none-match') === '*';
    if ((!expected && !create) || (expected && create))
      return json(400, { error: 'conditional write required' }, headers);
    if (Number(request.headers.get('content-length')) > 5 * 1024 * 1024)
      return json(413, { error: 'file too large' }, headers);
    const body = await request.arrayBuffer();
    if (body.byteLength > 5 * 1024 * 1024) return json(413, { error: 'file too large' }, headers);
    let value: {
      format?: unknown;
      schemaVersion?: unknown;
      id?: unknown;
      title?: unknown;
      kind?: unknown;
      updatedAt?: unknown;
    };
    try {
      value = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return json(400, { error: 'invalid JSON' }, headers);
    }
    if (
      !value ||
      value.format !== 'paperlab-corpus' ||
      value.schemaVersion !== 1 ||
      value.id !== id ||
      typeof value.title !== 'string' ||
      typeof value.kind !== 'string' ||
      typeof value.updatedAt !== 'string'
    )
      return json(400, { error: 'invalid corpus' }, headers);
    const stored = await deps.bucket.put(key, body, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        title: value.title,
        kind: value.kind,
        updatedAt: value.updatedAt,
        updatedBy: caller.email,
      },
      onlyIf: create ? { etagDoesNotMatch: '*' } : { etagMatches: expected as string },
    });
    if (!stored) return json(409, { version: (await deps.bucket.head(key))?.etag ?? null }, headers);
    return json(create ? 201 : 200, { version: stored.etag }, headers);
  }
  const sha = match?.[1] as string;
  const key = `${PREFIX}${sha}.pdf`;

  if (request.method === 'HEAD')
    return new Response(null, { status: (await deps.bucket.head(key)) ? 200 : 404, headers });
  if (request.method === 'GET') {
    const object = await deps.bucket.get(key);
    if (!object) return json(404, { error: 'not stored' }, headers);
    return new Response(object.body, {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Length': String(object.size) },
    });
  }
  if (request.method !== 'PUT') return json(405, { error: 'method not allowed' }, headers);

  if ((request.headers.get('content-type') ?? '').split(';')[0]?.trim() !== 'application/pdf')
    return json(415, { error: 'expected application/pdf' }, headers);
  const length = request.headers.get('content-length');
  if (length === null) return json(411, { error: 'length required' }, headers);
  if (Number(length) > MAX_BYTES) return json(413, { error: 'file too large' }, headers);
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return json(413, { error: 'file too large' }, headers);
  if (new TextDecoder().decode(body.slice(0, 5)) !== '%PDF-')
    return json(400, { error: 'not a PDF' }, headers);
  if ((await sha256Hex(body)) !== sha)
    return json(422, { error: 'content does not match its name' }, headers);
  if (await deps.bucket.head(key)) return json(200, { stored: true, existing: true }, headers);
  await deps.bucket.put(key, body, {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: { uploadedBy: caller.email, uploadedAt: deps.now().toISOString() },
  });
  return json(201, { stored: true }, headers);
}
