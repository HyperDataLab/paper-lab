import { afterEach, expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import { CorpusConflict, pullCorpus, pullCorpora, pushCorpus } from './index';

afterEach(() => vi.unstubAllGlobals());
it('C1d creates and updates with conditional versions and validates remote corpora', async () => {
  const corpus = exampleCorpus();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ version: 'v1' }), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ version: 'v2' })))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: corpus.id,
            title: corpus.title,
            kind: corpus.kind,
            updatedAt: corpus.updatedAt,
            version: 'v2',
          },
        ]),
      ),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ corpus, version: 'v2' })));
  vi.stubGlobal('fetch', fetchMock);
  expect(await pushCorpus(corpus, null, 'token')).toBe('v1');
  expect(await pushCorpus(corpus, 'v1', 'token')).toBe('v2');
  expect(fetchMock.mock.calls[0]?.[1].headers).toMatchObject({
    'If-None-Match': '*',
    Authorization: 'Bearer token',
  });
  expect(fetchMock.mock.calls[1]?.[1].headers).toMatchObject({ 'If-Match': 'v1' });
  expect(await pullCorpora('token')).toHaveLength(1);
  expect((await pullCorpus(corpus.id, 'token')).corpus).toEqual(corpus);
});
it('C1d exposes the current version on a conflict', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: 'v3' }), { status: 409 })),
  );
  await expect(pushCorpus(exampleCorpus(), 'v1', 'token')).rejects.toEqual(new CorpusConflict('v3'));
});
