import { NotAllowedError } from './auth';

export interface Bucket {
  get(key: string): Promise<{ body: ReadableStream } | null>;
  put(key: string, value: string, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
}
export interface Deps {
  bucket: Bucket;
  origins: string[];
  verify(token: string): Promise<unknown>;
  container(path: string, init?: RequestInit): Promise<Response>;
}
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const route = new RegExp(`^/corpora/(${uuid})/topics(?:/run(?:/(${uuid}))?)?$`, 'i');
const idPattern = new RegExp(`^${uuid}$`, 'i');
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin && deps.origins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, HEAD, PUT, POST';
    headers['Access-Control-Allow-Headers'] = 'authorization, content-type, if-match, if-none-match';
    headers['Access-Control-Max-Age'] = '3600';
  }
  const json = (status: number, value: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { ...headers, ...extra, 'Content-Type': 'application/json' },
    });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const path = new URL(request.url).pathname;
  const match = route.exec(path);
  if (!match) return json(400, { error: 'invalid path' });
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return json(401, { error: 'sign-in required' });
  try {
    await deps.verify(token);
  } catch (error) {
    return json(error instanceof NotAllowedError ? 403 : 401, { error: 'invalid token' });
  }
  const corpusId = match[1] as string;
  const jobId = match[2];
  const isRun = path.endsWith('/run') || Boolean(jobId);
  if (!isRun) {
    if (request.method !== 'GET') return json(405, { error: 'method not allowed' });
    const stored = await deps.bucket.get(`paperlab/corpora-topics/${corpusId}.json`);
    return stored
      ? new Response(stored.body, { headers: { ...headers, 'Content-Type': 'application/json' } })
      : json(404, { error: 'not stored' });
  }
  const call = async (url: string, init?: RequestInit) => {
    try {
      return await deps.container(url, init);
    } catch {
      return null;
    }
  };
  if (!jobId) {
    if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'invalid JSON' });
    }
    if (
      !object(body) ||
      (body.controlIds !== undefined &&
        (!Array.isArray(body.controlIds) ||
          !body.controlIds.every((id: unknown) => typeof id === 'string' && idPattern.test(id))))
    )
      return json(400, { error: 'invalid controls' });
    const ids = [corpusId, ...((body.controlIds as string[] | undefined) ?? [])];
    if (new Set(ids).size !== ids.length) return json(400, { error: 'duplicate corpus' });
    const corpora = [];
    const members = [];
    for (const id of ids) {
      const stored = await deps.bucket.get(`paperlab/corpora/${id}`);
      if (!stored) return json(404, { error: 'corpus not stored' });
      const corpus: unknown = await new Response(stored.body).json();
      if (
        !object(corpus) ||
        corpus.id !== id ||
        !Array.isArray(corpus.members) ||
        (id !== corpusId && corpus.kind !== 'control')
      )
        return json(400, { error: 'invalid corpus' });
      corpora.push({
        corpusId: id,
        title: corpus.title,
        kind: corpus.kind,
        ...(corpus.releaseId ? { releaseId: corpus.releaseId } : {}),
      });
      for (const m of corpus.members) {
        if (!object(m)) return json(400, { error: 'invalid member' });
        const identifiers = object(m.identifiers) ? m.identifiers : {};
        members.push({
          corpusId: id,
          memberId: m.memberId,
          title: m.title ?? '',
          openalexId: identifiers.openalexId ?? null,
          doi: identifiers.doi ?? null,
        });
      }
    }
    const response = await call('/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corpora, members }),
    });
    if (!response) return json(503, { error: 'container starting' }, { 'Retry-After': '30' });
    if (response.status === 503) return json(503, { error: 'container starting' }, { 'Retry-After': '30' });
    const value: unknown = await response.json();
    if (response.status !== 202) return json(response.status, value);
    if (!object(value) || typeof value.jobId !== 'string' || !idPattern.test(value.jobId))
      return json(502, { error: 'invalid job' });
    await deps.bucket.put(`paperlab/topics-jobs/${corpusId}/${value.jobId}.json`, JSON.stringify({ ids }), {
      httpMetadata: { contentType: 'application/json' },
    });
    return json(202, value);
  }
  if (request.method !== 'GET') return json(405, { error: 'method not allowed' });
  const pointer = await deps.bucket.get(`paperlab/topics-jobs/${corpusId}/${jobId}.json`);
  if (!pointer) return json(404, { error: 'job not found' });
  const saved: unknown = await new Response(pointer.body).json();
  if (
    !object(saved) ||
    !Array.isArray(saved.ids) ||
    !saved.ids.every((id: unknown) => typeof id === 'string' && idPattern.test(id))
  )
    return json(502, { error: 'invalid job pointer' });
  const status = await call(`/jobs/${jobId}`);
  if (!status) return json(503, { error: 'container starting' }, { 'Retry-After': '30' });
  const state: unknown = await status.json();
  if (!status.ok || !object(state) || state.state !== 'done') return json(status.status, state);
  const result = await call(`/jobs/${jobId}/result`);
  if (!result?.ok) return json(502, { error: 'result unavailable' });
  const snapshot: unknown = await result.json();
  if (
    !object(snapshot) ||
    snapshot.format !== 'paperlab-corpus-topics' ||
    snapshot.schemaVersion !== 1 ||
    typeof snapshot.snapshotId !== 'string' ||
    !Array.isArray(snapshot.corpora) ||
    !saved.ids.every((id: string) =>
      (snapshot.corpora as unknown[]).some((c) => object(c) && c.corpusId === id),
    )
  )
    return json(502, { error: 'invalid result' });
  for (const id of saved.ids as string[])
    await deps.bucket.put(`paperlab/corpora-topics/${id}.json`, JSON.stringify(snapshot), {
      httpMetadata: { contentType: 'application/json' },
    });
  return json(200, { state: 'done', snapshotId: snapshot.snapshotId });
}
