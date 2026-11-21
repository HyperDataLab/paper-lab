import { afterEach, expect, it, vi } from 'vitest';
import { KG_EDGE_TABLES, KG_NODE_TABLES } from '@/core/schemas/labKg';
import { enqueueLabKg, getLabKgStats, getLabKgStatus, labKgIds, LabKgError } from './client';

afterEach(() => vi.unstubAllGlobals());

it('prefers a usable OpenAlex ID, falls back to DOI and removes duplicate identifiers', () => {
  expect(
    labKgIds([
      { doi: '10.1000/a', openalexId: 'https://openalex.org/W1' },
      { openalexId: 'w1' },
      { doi: 'doi:10.1000/B', openalexId: 'A1' },
      {},
    ]),
  ).toEqual(['W1', '10.1000/b']);
});

it('sends at most 50 identifiers per authenticated POST and combines the results', async () => {
  const fetcher = vi.fn(async (url: string, request: RequestInit) => {
    expect(url).toMatch(/\/v1\/kg\/ingest\?projectId=rh-1$/u);
    expect(request).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer lab', 'X-Project-Id': 'rh-1' },
    });
    const { ids } = JSON.parse(String(request.body)) as { ids: string[] };
    return Response.json({ queued: ids.length - 1, processed: 1, skipped: 1, errors: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  const ids = Array.from({ length: 105 }, (_, index) => `W${index + 1}`);
  expect(await enqueueLabKg(ids, 'lab', 'rh-1')).toEqual({
    queued: 102,
    processed: 3,
    skipped: 3,
    errors: [],
  });
  expect(fetcher.mock.calls.map(([, request]) => JSON.parse(String(request.body)).ids)).toEqual([
    ids.slice(0, 50),
    ids.slice(50, 100),
    ids.slice(100),
  ]);
});

it('checks sign-in and validates the status response', async () => {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  await expect(getLabKgStatus(null, 'rh-1')).rejects.toThrow('Hãy đăng nhập');
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValueOnce(Response.json({ error: 'kg_not_configured' }, { status: 503 }));
  await expect(getLabKgStatus('lab', 'rh-1')).rejects.toMatchObject({
    detail: 'HTTP 503 · kg_not_configured',
  });
  fetcher.mockResolvedValueOnce(Response.json({ counts: { pending: 1 }, logs: [] }));
  await expect(getLabKgStatus('lab', 'rh-1')).rejects.toThrow('Không đọc được trạng thái');
});

it('does not call the worker without an active ResearchHub project', async () => {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  await expect(getLabKgStatus('lab', '')).rejects.toThrow('project ResearchHub');
  expect(fetcher).not.toHaveBeenCalled();
});

const stats = {
  nodes: Object.fromEntries(KG_NODE_TABLES.map((name) => [name, 0])),
  edges: Object.fromEntries(KG_EDGE_TABLES.map((name) => [name, 0])),
  queue: { pending: 0, processing: 0, done: 0, failed: 0 },
};

it('names the failure by status and keeps the status and code for the page', async () => {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  const cases: [Response | Error, string, string][] = [
    [
      Response.json({ error: 'kg_not_configured' }, { status: 503 }),
      'chưa được cấu hình',
      'HTTP 503 · kg_not_configured',
    ],
    [
      Response.json({ error: 'internal' }, { status: 500 }),
      'Máy chủ KG của lab gặp lỗi (HTTP 500).',
      'HTTP 500 · internal',
    ],
    [new Response('bad gateway', { status: 502 }), 'Máy chủ KG của lab gặp lỗi (HTTP 502).', 'HTTP 502'],
    [
      Response.json({ error: 'not_found' }, { status: 404 }),
      'KG của lab chưa có mục này.',
      'HTTP 404 · not_found',
    ],
    [new TypeError('Failed to fetch'), 'Không kết nối được máy chủ lab', 'Network error: Failed to fetch'],
  ];
  for (const [answer, message, detail] of cases) {
    if (answer instanceof Error) fetcher.mockRejectedValueOnce(answer);
    else fetcher.mockResolvedValueOnce(answer);
    const error = await getLabKgStats('lab', 'rh-1').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(LabKgError);
    expect((error as LabKgError).message).toContain(message);
    expect((error as LabKgError).detail).toBe(detail);
  }
  fetcher.mockResolvedValueOnce(Response.json({ error: 'not_found' }, { status: 404 }));
  await expect(getLabKgStats('lab', 'rh-1')).rejects.toMatchObject({ status: 404, code: 'not_found' });
});

it('asks again without revalidation when a bodiless 304 reaches the client', async () => {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  fetcher
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
    .mockResolvedValueOnce(Response.json(stats));
  expect((await getLabKgStats('lab', 'rh-1')).nodes.paper).toBe(0);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ cache: 'reload' });
});
