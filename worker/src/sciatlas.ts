// POST /v1/sciatlas/search: related papers from SciAtlas (OpenKG), called with the lab's token.
// SciAtlas is plain HTTP, so the browser cannot reach it from https. The data licence is not stated:
// results are passed through, never stored, and the query text is never logged.
import {
  readSciAtlasEnvelope,
  SCIATLAS_MAX_TOP_K,
  SciAtlasSearchRequestSchema,
  toSciAtlasPayload,
} from '../../src/core/openkg/sciatlas';
import type { Deps } from './app';
import { publishedError } from './published';

export const SCIATLAS_PATH = '/v1/sciatlas/search';
export const SCIATLAS_URL = 'http://sciatlas.openkg.cn/v1/search';
export const SCIATLAS_TIMEOUT_MS = 60_000;
const MAX_BODY = 64 * 1024;
type Headers = Record<string, string>;

/** The caller has already checked the Firebase token. */
export async function handleSciAtlas(deps: Deps, request: Request, headers: Headers) {
  const reply = { ...headers, 'Cache-Control': 'no-store' };
  const fail = (status: number, error: string, message: string) =>
    publishedError(status, error, message, reply);
  if (request.method !== 'POST') return fail(405, 'bad_request', 'Use POST.');
  const key = deps.sciatlasKey?.trim();
  if (!key) return fail(503, 'sciatlas_not_configured', 'SciAtlas is not configured on this worker.');
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY)
    return fail(413, 'bad_request', 'Request exceeds 64 KB.');
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY) return fail(413, 'bad_request', 'Request exceeds 64 KB.');
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return fail(400, 'bad_request', 'Body is not JSON.');
  }
  const input = SciAtlasSearchRequestSchema.safeParse(body);
  // Only the failing field paths are echoed, never the query.
  if (!input.success)
    return fail(
      400,
      'bad_request',
      `Invalid search: ${[...new Set(input.error.issues.map((issue) => issue.path.join('.') || 'body'))].join(', ')}.`,
    );

  const start = Date.now();
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(SCIATLAS_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'X-API-Key': key,
      },
      body: JSON.stringify(toSciAtlasPayload(input.data)),
      signal: AbortSignal.timeout(deps.sciatlasTimeoutMs ?? SCIATLAS_TIMEOUT_MS),
    });
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : '';
    return name === 'TimeoutError' || name === 'AbortError'
      ? fail(504, 'sciatlas_timeout', 'SciAtlas did not answer in time.')
      : fail(502, 'sciatlas_error', 'SciAtlas could not be reached.');
  }
  if (response.status === 401 || response.status === 403)
    return fail(502, 'sciatlas_auth', `SciAtlas rejected the lab token (${response.status}).`);
  if (response.status === 429) return fail(429, 'sciatlas_quota', 'The SciAtlas daily quota is used up.');
  if (!response.ok) return fail(502, 'sciatlas_error', `SciAtlas answered ${response.status}.`);
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : '';
    return name === 'TimeoutError' || name === 'AbortError'
      ? fail(504, 'sciatlas_timeout', 'SciAtlas did not answer in time.')
      : fail(502, 'sciatlas_error', 'SciAtlas returned an unreadable answer.');
  }
  const envelope = readSciAtlasEnvelope(parsed);
  if (!envelope.ok)
    return new Response(
      JSON.stringify({
        error: 'sciatlas_error',
        message: 'SciAtlas returned an error.',
        ...(envelope.requestId ? { requestId: envelope.requestId } : {}),
      }),
      { status: 502, headers: { ...reply, 'Content-Type': 'application/json' } },
    );
  return new Response(
    JSON.stringify({
      papers: envelope.papers.slice(0, Math.min(input.data.topK, SCIATLAS_MAX_TOP_K)),
      ...(envelope.requestId ? { requestId: envelope.requestId } : {}),
      elapsedMs: Date.now() - start,
    }),
    { status: 200, headers: { ...reply, 'Content-Type': 'application/json' } },
  );
}
