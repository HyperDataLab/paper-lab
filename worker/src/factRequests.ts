import { isAdmin, type Deps } from './deps';
import { publishedError } from './published';

const PREFIX = 'paperlab/fact-requests/';
const ID = '(sha256-[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const PAPER_PATH = new RegExp(`^/v1/papers/${ID}/experiment-facts/requests$`);
const DECISION_PATH = new RegExp(`^/v1/admin/fact-requests/${ID}/decision$`);
type State = 'requested' | 'approved' | 'declined' | 'done';
type FactRequest = {
  paperId: string;
  state: State;
  note: string | null;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};
type Headers = Record<string, string>;
const json = (status: number, value: unknown, headers: Headers) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
const key = (id: string) => `${PREFIX}${id}.json`;

export async function readFactRequest(deps: Deps, id: string) {
  const object = await deps.bucket.get(key(id));
  if (!object) return null;
  return { value: JSON.parse(await new Response(object.body).text()) as FactRequest, etag: object.etag };
}

async function write(deps: Deps, value: FactRequest, etag?: string) {
  return deps.bucket.put(key(value.paperId), new TextEncoder().encode(JSON.stringify(value)).buffer, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { state: value.state },
    onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
  });
}

export async function completeFactRequest(deps: Deps, id: string) {
  for (;;) {
    const existing = await readFactRequest(deps, id);
    if (!existing || !['requested', 'approved'].includes(existing.value.state)) return;
    if (await write(deps, { ...existing.value, state: 'done' }, existing.etag)) return;
  }
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
const validNote = (note: unknown) => note === undefined || (typeof note === 'string' && note.length <= 1000);

export async function handleFactRequests(deps: Deps, request: Request, email: string, headers: Headers) {
  const url = new URL(request.url);
  const admin = url.pathname.startsWith('/v1/admin/');
  if (admin && !isAdmin(deps, email)) return publishedError(403, 'forbidden', 'Forbidden.', headers);
  if (url.pathname === '/v1/admin/fact-requests' && request.method === 'GET') {
    const state = url.searchParams.get('state');
    if (state && !['requested', 'approved', 'declined', 'done'].includes(state))
      return publishedError(400, 'bad_request', 'Invalid state.', headers);
    const page = await deps.bucket.list({
      prefix: PREFIX,
      cursor: url.searchParams.get('cursor') || undefined,
      limit: 100,
      include: ['customMetadata'],
    });
    const items = await Promise.all(
      page.objects
        .filter(
          (object) => object.key.endsWith('.json') && (!state || object.customMetadata?.state === state),
        )
        .map(async (object) => {
          const id = object.key.slice(PREFIX.length, -5);
          const entry = await readFactRequest(deps, id);
          const model = await deps.bucket.head(`paperlab/published/${id}/model.json`);
          return entry
            ? {
                ...entry.value,
                title: model?.customMetadata?.title ?? null,
                doi: model?.customMetadata?.doi || null,
              }
            : null;
        }),
    );
    return json(
      200,
      {
        items: items.filter((item) => item !== null),
        nextCursor: page.truncated ? (page.cursor ?? null) : null,
      },
      headers,
    );
  }
  const paper = PAPER_PATH.exec(url.pathname);
  const decision = DECISION_PATH.exec(url.pathname);
  const id = paper?.[1] ?? decision?.[1];
  if (
    !id ||
    (paper && request.method !== 'GET' && request.method !== 'POST') ||
    (decision && request.method !== 'POST')
  )
    return publishedError(400, 'bad_request', 'Invalid path or method.', headers);
  if (paper && request.method === 'GET') {
    const existing = await readFactRequest(deps, id);
    if (!existing) return publishedError(404, 'not_found', 'Request was not found.', headers);
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(existing.value)),
    );
    const etag = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const responseHeaders = { ...headers, ETag: `"${etag}"` };
    const requested = request.headers
      .get('if-none-match')
      ?.replace(/^W\//u, '')
      .replace(/^"(.*)"$/u, '$1');
    return requested === etag
      ? new Response(null, { status: 304, headers: responseHeaders })
      : json(200, existing.value, responseHeaders);
  }
  const input = await body(request);
  if (
    !input ||
    !validNote(input.note) ||
    (decision && input.decision !== 'approve' && input.decision !== 'decline')
  )
    return publishedError(400, 'bad_request', 'Invalid request.', headers);
  if (paper && !(await deps.bucket.head(`paperlab/published/${id}/model.json`)))
    return publishedError(404, 'not_found', `Paper ${id} was not found.`, headers);
  for (;;) {
    if (paper && (await deps.bucket.head(`paperlab/published/${id}/experiment-facts.json`)))
      return publishedError(409, 'conflict', 'Facts already published.', headers);
    const existing = await readFactRequest(deps, id);
    if (decision) {
      if (!existing || existing.value.state !== 'requested')
        return publishedError(409, 'conflict', 'Request is not awaiting a decision.', headers);
      const updated: FactRequest = {
        ...existing.value,
        state: input.decision === 'approve' ? 'approved' : 'declined',
        decidedBy: email,
        decidedAt: deps.now().toISOString(),
        decisionNote: (input.note as string | undefined) ?? null,
      };
      if (await write(deps, updated, existing.etag)) return json(200, updated, headers);
    } else {
      if (existing && (existing.value.state === 'requested' || existing.value.state === 'approved'))
        return json(202, existing.value, headers);
      const value: FactRequest = {
        paperId: id,
        state: 'requested',
        note: (input.note as string | undefined) ?? null,
        requestedBy: email,
        requestedAt: deps.now().toISOString(),
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
      };
      if (await write(deps, value, existing?.etag)) {
        // A concurrent facts publication may have completed before this request was written.
        if (await deps.bucket.head(`paperlab/published/${id}/experiment-facts.json`)) {
          await completeFactRequest(deps, id);
          return publishedError(409, 'conflict', 'Facts already published.', headers);
        }
        return json(202, { requestId: id, state: 'requested' }, headers);
      }
    }
  }
}
