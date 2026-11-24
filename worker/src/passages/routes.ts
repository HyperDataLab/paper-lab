import {
  PassageReindexRequestSchema,
  PassageSearchRequestSchema,
  type PassageReindexResponse,
  type PassageSearchResponse,
} from '../../../src/core/schemas/passages';
import type { Deps } from '../app';
import { publishedError } from '../published';
import { configuredPassages } from './bindings';
import { drainPassageQueue, enqueuePapers, passageStatus, REQUEST_PAPERS } from './index';
import { corpusPaperIds, CorpusNotFoundError, searchPassages } from './search';

export const PASSAGES_PATH_PREFIX = '/v1/passages/';
const MAX_BODY = 64 * 1024;

async function readJson(request: Request) {
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY) return { tooLarge: true as const };
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY) return { tooLarge: true as const };
  if (!raw.byteLength) return { body: {} as unknown };
  try {
    return { body: JSON.parse(new TextDecoder().decode(raw)) as unknown };
  } catch {
    return { body: undefined };
  }
}

/** The passage index routes. The caller has verified the SSO token and the caller's ResearchHub project. */
export async function handlePassages(
  deps: Deps,
  request: Request,
  path: string,
  headers: Record<string, string>,
  projectId: string,
) {
  const reply = { ...headers, 'Cache-Control': 'no-store' };
  const fail = (status: number, error: string, message: string) =>
    publishedError(status, error, message, reply);
  const env = configuredPassages({
    db: deps.data,
    bucket: deps.bucket,
    vectors: deps.passageVectors,
    ai: deps.kg?.AI,
  });
  if (!env) return fail(503, 'passages_not_configured', 'The passage index bindings are unavailable.');

  if (path === '/v1/passages/status') {
    if (request.method !== 'GET') return fail(405, 'bad_request', 'Use GET.');
    return Response.json(await passageStatus(env.db, projectId), { headers: reply });
  }
  if (path !== '/v1/passages/search' && path !== '/v1/passages/reindex')
    return fail(404, 'not_found', 'Not found.');
  if (request.method !== 'POST') return fail(405, 'bad_request', 'Use POST.');
  const read = await readJson(request);
  if ('tooLarge' in read) return fail(413, 'bad_request', 'Request exceeds 64 KB.');
  if (read.body === undefined) return fail(400, 'bad_request', 'Body is not JSON.');

  if (path === '/v1/passages/search') {
    const input = PassageSearchRequestSchema.safeParse(read.body);
    // Only the failing field paths are echoed, never the query.
    if (!input.success)
      return fail(
        400,
        'bad_request',
        `Invalid search: ${[...new Set(input.error.issues.map((issue) => issue.path.join('.') || 'body'))].join(', ')}.`,
      );
    try {
      const body: PassageSearchResponse = await searchPassages(env, input.data, projectId);
      return Response.json(body, { headers: reply });
    } catch (error) {
      if (error instanceof CorpusNotFoundError) return fail(404, 'corpus_not_found', 'No such corpus.');
      return fail(502, 'passages_error', 'The passage search failed.');
    }
  }

  const input = PassageReindexRequestSchema.safeParse(read.body);
  if (!input.success) return fail(400, 'bad_request', 'Send {paperIds}, {corpusId} or {}.');
  let paperIds: string[] | null = null;
  if ('paperIds' in input.data) paperIds = input.data.paperIds;
  else if ('corpusId' in input.data) {
    paperIds = await corpusPaperIds(env, projectId, input.data.corpusId);
    if (!paperIds) return fail(404, 'corpus_not_found', 'No such corpus.');
  }
  const queued =
    paperIds?.length === 0 ? 0 : await enqueuePapers(env.db, projectId, paperIds, deps.now().toISOString());
  const drained = queued
    ? await drainPassageQueue(env, { now: deps.now, limit: REQUEST_PAPERS, projectId })
    : { processed: 0 };
  const body: PassageReindexResponse = {
    queued,
    processed: drained.processed,
    status: await passageStatus(env.db, projectId),
  };
  return Response.json(body, { status: 202, headers: reply });
}
