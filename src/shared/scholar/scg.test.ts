import { expect, it, vi } from 'vitest';
import { createScholarClient, ScholarHttpError } from './client';

it('resolves DOI corpus ids, returns null for 404, and backs off on rate limits', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ corpusId: 52967399 }), { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ paperId: 'x' }), { status: 200 }))
    .mockResolvedValue(new Response(null, { status: 429 }));
  const sleep = vi.fn(async () => {});
  const client = createScholarClient({}, { fetch: fetcher, sleep });
  expect(await client.lookupS2CorpusId('10.18653/v1/N19-1423')).toBe('52967399');
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    'https://api.semanticscholar.org/graph/v1/paper/DOI:10.18653/v1/N19-1423?fields=corpusId',
  );
  expect(await client.lookupS2CorpusId('10.1/missing')).toBeNull();
  expect(await client.lookupS2CorpusId('10.1/no-id')).toBeNull();
  await expect(client.lookupS2CorpusId('10.1/limited')).rejects.toBeInstanceOf(ScholarHttpError);
  expect(sleep).toHaveBeenCalledTimes(2);
});
