import { afterEach, expect, it, vi } from 'vitest';
import { fetchGrobidTei } from './grobid';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('retries a cold container after Retry-After', async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 503, headers: { 'Retry-After': '2' } }))
    .mockResolvedValueOnce(new Response('<TEI/>'));
  vi.stubGlobal('fetch', fetchMock);
  const result = fetchGrobidTei('abc', '00000000-0000-4000-8000-000000000001', 'token');
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toBe('<TEI/>');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
