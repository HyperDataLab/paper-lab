import { afterEach, expect, it, vi } from 'vitest';
import { enqueueLabKg, getLabKgStatus, labKgIds } from './client';

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
    expect(url).toMatch(/\/v1\/kg\/ingest$/u);
    expect(request).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer lab' } });
    const { ids } = JSON.parse(String(request.body)) as { ids: string[] };
    return Response.json({ queued: ids.length - 1, processed: 1, skipped: 1, errors: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  const ids = Array.from({ length: 105 }, (_, index) => `W${index + 1}`);
  expect(await enqueueLabKg(ids, 'lab')).toEqual({ queued: 102, processed: 3, skipped: 3, errors: [] });
  expect(fetcher.mock.calls.map(([, request]) => JSON.parse(String(request.body)).ids)).toEqual([
    ids.slice(0, 50),
    ids.slice(50, 100),
    ids.slice(100),
  ]);
});

it('checks sign-in and validates the status response', async () => {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  await expect(getLabKgStatus(null)).rejects.toThrow('Hãy đăng nhập');
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValueOnce(Response.json({ error: 'kg_not_configured' }, { status: 503 }));
  await expect(getLabKgStatus('lab')).rejects.toMatchObject({ detail: 'HTTP 503 · kg_not_configured' });
  fetcher.mockResolvedValueOnce(Response.json({ counts: { pending: 1 }, logs: [] }));
  await expect(getLabKgStatus('lab')).rejects.toThrow('Không đọc được trạng thái');
});
