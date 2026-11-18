import { expect, it, vi } from 'vitest';
import { createJournalSearchClient } from './journals';

const token = async () => 'test-token';
const page = {
  items: [
    {
      id: 'jrn.synthetic',
      name: 'Synthetic Journal',
      issnL: '1234-5679',
      issns: ['1234-5679', '9876-5434'],
      openalexSourceId: 'S12345',
      publisher: 'Synthetic Press',
      fields: ['fields/17'],
      profile: 'jr.synthetic',
      kind: 'journal',
    },
    {
      id: 'jr.synthetic-conference',
      name: 'Synthetic Meeting',
      issns: [],
      openalexSourceId: null,
      kind: 'conference',
    },
  ],
  nextCursor: 'next+page',
};

it('authenticates live searches and keys journal ETags by query and cursor', async () => {
  const etag = 'W/"registry-a"';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(page, { headers: { ETag: etag } }))
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
    .mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }));
  const search = createJournalSearchClient({ baseUrl: 'https://bank.example/', fetch: fetcher });
  expect(await search(token, ' Synthetic & Journal ')).toEqual({ status: 'ok', ...page });
  expect(await search(token, 'Synthetic & Journal')).toEqual({ status: 'ok', ...page });
  const signal = new AbortController().signal;
  expect(await search(token, 'Synthetic & Journal', { cursor: 'next+page', signal })).toEqual({
    status: 'ok',
    items: [],
    nextCursor: null,
  });
  const url = 'https://bank.example/bank/v1/journals?q=Synthetic+%26+Journal&limit=20';
  const headers = { Authorization: 'Bearer test-token' };
  expect(fetcher).toHaveBeenNthCalledWith(1, url, { method: 'GET', headers });
  expect(fetcher).toHaveBeenNthCalledWith(2, url, {
    method: 'GET',
    headers: { ...headers, 'If-None-Match': etag },
  });
  expect(fetcher).toHaveBeenNthCalledWith(3, url + '&cursor=next%2Bpage', { method: 'GET', headers, signal });
});

it.each([
  ['1234-5679', 'issn=1234-5679'],
  ['9876543x', 'issn=9876543X'],
  ['s12345', 'openalex=S12345'],
  ['1234-56', 'q=1234-56'],
])('routes %s to the matching search parameter', async (query, params) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }));
  await createJournalSearchClient({ baseUrl: 'https://bank.example', fetch: fetcher })(token, query);
  expect(fetcher).toHaveBeenCalledWith(
    'https://bank.example/bank/v1/journals?' + params + '&limit=20',
    expect.anything(),
  );
});

it('reports unavailable for a missing route, network failure or missing token', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockRejectedValueOnce(new TypeError('Offline'));
  const search = createJournalSearchClient({ fetch: fetcher });
  expect(await search(token, 'Research')).toEqual({ status: 'unavailable', reason: 'missing_route' });
  expect(await search(token, 'Research')).toEqual({ status: 'unavailable', reason: 'network' });
  expect(await search(async () => null, 'Research')).toEqual({ status: 'unavailable', reason: 'signed_out' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
