import { describe, expect, it, vi } from 'vitest';
import { handle, type Bucket, type Deps } from './app';
import { NotAllowedError } from './auth';
import { SCIATLAS_URL } from './sciatlas';

const KEY = 'test-key';
const PROJECT_ID = '00000000-0000-4000-8000-000000000101';
const bucket: Bucket = {
  head: async () => null,
  get: async () => null,
  list: async () => ({ objects: [], truncated: false }),
  put: vi.fn(async () => ({ etag: 'r2' })),
};
const body = {
  query: 'Synthetic graph retrieval',
  keywords: [{ text: 'synthetic graphs', level: 'high' }],
  titles: [{ title: 'A synthetic study of graphs', level: 'high' }],
  references: ['An earlier synthetic study'],
  after: '2019-01-01',
  before: '2029-12-31',
  topK: 5,
  ranking: 'balanced',
};
const ok = (data: unknown) =>
  new Response(JSON.stringify({ status: 'ok', request_id: 'req-1', data }), {
    headers: { 'Content-Type': 'application/json' },
  });

function setup(
  upstream?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  extra: Partial<Deps> = {},
) {
  const fetcher = vi.fn(upstream ?? (async () => ok([])));
  const deps: Deps = {
    bucket,
    verifyToken: async () => ({ uid: '1', email: 'test@example.org', kind: 'sso' as const }),
    allowedOrigins: ['https://example.org'],
    getOwnedProject: async (projectId) => ({ id: projectId, name: 'Test project' }),
    now: () => new Date('2026-11-18T00:00:00Z'),
    sciatlasKey: KEY,
    fetch: fetcher as unknown as typeof fetch,
    ...extra,
  };
  const call = (
    value: unknown = body,
    headers: Record<string, string> = { authorization: 'Bearer token', 'X-Project-Id': PROJECT_ID },
  ) =>
    handle(
      deps,
      new Request('https://worker.test/v1/sciatlas/search', {
        method: 'POST',
        headers: { origin: 'https://example.org', 'X-Project-Id': PROJECT_ID, ...headers },
        body: JSON.stringify(value),
      }),
    );
  return { call, fetcher };
}
const text = async (response: Response) => {
  const value = await response.text();
  expect(value).not.toContain(KEY);
  for (const [, header] of response.headers) expect(header).not.toContain(KEY);
  return value;
};

describe('K4 SciAtlas proxy', () => {
  it('K4 needs a lab sign-in', async () => {
    const { call, fetcher } = setup();
    expect((await call(body, {})).status).toBe(401);
    const forbidden = setup(undefined, {
      verifyToken: async () => {
        throw new NotAllowedError('domain');
      },
    });
    expect((await forbidden.call()).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('K4 answers 503 sciatlas_not_configured without the secret', async () => {
    const { call, fetcher } = setup(undefined, { sciatlasKey: undefined });
    const response = await call();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(await text(response))).toMatchObject({ error: 'sciatlas_not_configured' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('K4 rejects a search without a keyword or title', async () => {
    const { call, fetcher } = setup();
    const response = await call({ query: 'only text', keywords: [], titles: [] });
    expect(response.status).toBe(400);
    expect(await text(response)).not.toContain('only text');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('K4 sends the SciAtlas payload with the key in both headers and returns normalised papers', async () => {
    const { call, fetcher } = setup(async () =>
      ok({
        results: [
          {
            paper_title: 'Related synthetic paper',
            publication_year: 2022,
            similarity: 0.8,
            cited_by_count: 12,
            journal: 'Synthetic Journal',
            author_names: ['A. Tester'],
            doi: 'https://doi.org/10.1000/ABC',
            openalex_id: 'https://openalex.org/W123',
          },
          { title: 'Related synthetic paper', doi: '10.1000/abc' },
        ],
      }),
    );
    const response = await call({ ...body, topK: 50 });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(await text(response))).toMatchObject({
      requestId: 'req-1',
      papers: [
        {
          rank: 1,
          title: 'Related synthetic paper',
          year: 2022,
          score: 0.8,
          citations: 12,
          venue: 'Synthetic Journal',
          authors: ['A. Tester'],
          doi: '10.1000/abc',
          openalexId: 'W123',
        },
      ],
    });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SCIATLAS_URL);
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, 'X-API-Key': KEY });
    const payload = JSON.parse(String(init.body));
    expect(payload.plan).toMatchObject({
      source_type: 'idea_text',
      keywords: [{ text: 'synthetic graphs', score: 9 }],
      titles: [{ title: 'A synthetic study of graphs', confidence: 0.95 }],
      reference_titles: ['An earlier synthetic study'],
    });
    expect(payload.options).toMatchObject({
      top_k: 20,
      retrieval_mode: 'hybrid',
      after: '2019-01-01',
      before: '2029-12-31',
      retrieval_bias: { ranking_profile: 'balanced' },
    });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it.each([
    [401, 502, 'sciatlas_auth'],
    [403, 502, 'sciatlas_auth'],
    [429, 429, 'sciatlas_quota'],
    [500, 502, 'sciatlas_error'],
  ])('K4 maps SciAtlas %i to %i %s without forwarding its text', async (upstream, status, error) => {
    const { call } = setup(
      async () => new Response(JSON.stringify({ detail: `bad token ${KEY}` }), { status: upstream }),
    );
    const response = await call();
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(await text(response))).toMatchObject({ error });
  });

  it('K4 maps a non-ok envelope to 502 and keeps only the request id', async () => {
    const { call } = setup(
      async () => new Response(JSON.stringify({ status: 'error', detail: KEY, request_id: 'req-9' })),
    );
    const response = await call();
    expect(response.status).toBe(502);
    expect(JSON.parse(await text(response))).toEqual({
      error: 'sciatlas_error',
      message: 'SciAtlas returned an error.',
      requestId: 'req-9',
    });
  });

  it('K4 maps a timeout to 504 and a network failure to 502', async () => {
    const slow = setup(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
        ),
      { sciatlasTimeoutMs: 5 },
    );
    const timeout = await slow.call();
    expect(timeout.status).toBe(504);
    expect(JSON.parse(await text(timeout))).toMatchObject({ error: 'sciatlas_timeout' });
    const down = setup(async () => {
      throw new TypeError(`connect failed ${KEY}`);
    });
    const failed = await down.call();
    expect(failed.status).toBe(502);
    expect(JSON.parse(await text(failed))).toMatchObject({ error: 'sciatlas_error' });
  });
});
