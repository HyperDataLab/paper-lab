import { expect, it, vi } from 'vitest';
import { createBankCatalogClient } from './catalog';

const articleType = { id: 'art.synthetic', name: 'Synthetic article', aliases: ['article'] };
const token = async () => 'test-token';
const snapshot = (release: string) => ({
  format: 'writing-bank-snapshot',
  formatVersion: 1,
  release,
  collections: { 'article-types': [articleType] },
});

it('loads article types and reuses a validated release on 304', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(snapshot('2031.02.1')))
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
    .mockResolvedValueOnce(Response.json(snapshot('2031.02.2')))
    .mockResolvedValueOnce(new Response(null, { status: 304 }));
  const load = createBankCatalogClient({ baseUrl: 'https://bank.example', fetch: fetcher });
  const initial = await load(token);
  expect(initial).toEqual({
    status: 'ok',
    release: '2031.02.1',
    articleTypes: [articleType],
  });
  expect(await load(token)).toBe(initial);
  const latest = await load(token);
  expect(latest).toMatchObject({ status: 'ok', release: '2031.02.2' });
  expect(await load(token)).toBe(latest);
  const url = 'https://bank.example/bank/v1/snapshot?collections=article-types';
  expect(fetcher).toHaveBeenNthCalledWith(1, url, {
    method: 'GET',
    headers: { Authorization: 'Bearer test-token' },
  });
  expect(fetcher).toHaveBeenNthCalledWith(2, url, {
    method: 'GET',
    headers: { Authorization: 'Bearer test-token', 'If-None-Match': '"2031.02.1"' },
  });
  expect(fetcher).toHaveBeenNthCalledWith(4, url, {
    method: 'GET',
    headers: { Authorization: 'Bearer test-token', 'If-None-Match': '"2031.02.2"' },
  });
});

it('reports a 400 for collections that are not served yet and can recover', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ error: 'bad_request', message: 'Unknown collection' }, { status: 400 }),
    )
    .mockResolvedValueOnce(Response.json(snapshot('2031.02.1')));
  const load = createBankCatalogClient({ fetch: fetcher });
  expect(await load(token)).toEqual({ status: 'unavailable', reason: 'collections_missing' });
  expect(await load(token)).toMatchObject({ status: 'ok' });
});

it('reports network failure and requires a token even after a release is cached', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(snapshot('2031.02.1')))
    .mockRejectedValueOnce(new TypeError('Offline'));
  const load = createBankCatalogClient({ fetch: fetcher });
  await load(token);
  expect(await load(token)).toEqual({ status: 'unavailable', reason: 'network' });
  expect(await load(async () => null)).toEqual({ status: 'unavailable', reason: 'signed_out' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('rejects article types without the required aliases list', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
    Response.json({
      ...snapshot('2031.02.1'),
      collections: { 'article-types': [{ id: articleType.id, name: articleType.name }] },
    }),
  );
  const load = createBankCatalogClient({ fetch: fetcher });
  expect(await load(token)).toEqual({ status: 'unavailable', reason: 'invalid' });
});
