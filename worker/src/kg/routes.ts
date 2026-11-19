import { KgIngestRequestSchema } from '../../../src/core/schemas/labKg';
import type { Deps } from '../app';
import { publishedError } from '../published';
import { configuredKg } from './bindings';
import { handleKgGraph } from './graph';
import { drainKgQueue, REQUEST_JOBS } from './ingest';
import { kgQueue } from './queue';
import { handleKgRead } from './reads';
import { handleKgSearch } from './search';

export async function handleKg(deps: Deps, request: Request, path: string, headers: Record<string, string>) {
  const kg = configuredKg(deps.kg);
  if (!kg) return publishedError(503, 'kg_not_configured', 'The lab KG bindings are unavailable.', headers);
  if (path === '/v1/kg/search') {
    if (request.method !== 'POST')
      return publishedError(405, 'bad_request', 'Use POST.', { ...headers, 'Cache-Control': 'no-store' });
    return handleKgSearch(kg, request, headers, deps.now);
  }
  if (path === '/v1/kg/stats' || path.startsWith('/v1/kg/papers/') || path.startsWith('/v1/kg/keywords/'))
    return handleKgRead(kg.db, request, path, headers);
  if (path === '/v1/kg/graph' || path === '/v1/kg/trend') return handleKgGraph(kg.db, request, path, headers);

  const queue = kgQueue(kg.db);
  if (path === '/v1/kg/ingest/status' && request.method === 'GET')
    return Response.json(await queue.status(), { headers });
  if (path !== '/v1/kg/ingest' || request.method !== 'POST')
    return publishedError(400, 'bad_request', 'Invalid path or method.', headers);

  const body = KgIngestRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return publishedError(
      400,
      'bad_request',
      'Expected 1–50 OpenAlex work IDs or DOIs, an optional depth (0–2) and source.',
      headers,
    );
  const { ids, depth, source } = body.data;
  const queued = await queue.enqueue(ids, depth, source, deps.now().toISOString());
  const drained = await drainKgQueue(kg, { now: deps.now, fetcher: deps.fetch, limit: REQUEST_JOBS, ids });
  return Response.json({ queued, skipped: ids.length - queued, ...drained }, { status: 202, headers });
}
