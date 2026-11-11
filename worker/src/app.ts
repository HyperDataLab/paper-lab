import { NotAllowedError } from './auth';

/** The part of an R2 bucket this worker uses, so the logic runs in tests without Cloudflare. */
export interface Bucket {
  head(key: string): Promise<unknown | null>;
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options: { httpMetadata: { contentType: string }; customMetadata: Record<string, string> },
  ): Promise<unknown>;
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

function cors(request: Request, deps: Deps): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin || !deps.allowedOrigins.includes(origin)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, PUT',
    'Access-Control-Allow-Headers': 'authorization, content-type',
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
  const match = SHA.exec(new URL(request.url).pathname);
  if (!match) return json(400, { error: 'expected /pdfs/<sha256>' }, headers);
  const sha = match[1] as string;
  const key = `${PREFIX}${sha}.pdf`;

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
