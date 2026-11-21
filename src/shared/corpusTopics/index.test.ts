import { afterEach, expect, it, vi } from 'vitest';
import { pullCorpusTopics } from './index';

afterEach(() => vi.unstubAllGlobals());
it('validates topic snapshots and treats a missing snapshot as empty', async () => {
  const snapshot = {
    format: 'paperlab-corpus-topics',
    schemaVersion: 1,
    snapshotId: 'run',
    createdAt: '2026-01-01T00:00:00Z',
    corpora: [{ corpusId: 'a', kind: 'journal', title: 'A' }],
    pipeline: {
      tag: 'test',
      embeddingModel: 'test',
      parameters: {},
      seed: 1,
      textSource: 'abstract',
      openalexFetchedAt: '2026-01-01T00:00:00Z',
    },
    quality: { outlierShare: 0 },
    topics: [],
    members: [],
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(snapshot)))
    .mockResolvedValueOnce(new Response(JSON.stringify(snapshot)));
  vi.stubGlobal('fetch', fetchMock);
  expect(await pullCorpusTopics('a', 'token')).toBeUndefined();
  expect(await pullCorpusTopics('a', 'token')).toEqual(snapshot);
  expect(fetchMock.mock.calls[1]?.[1].headers).toEqual({ Authorization: 'Bearer token' });
  await expect(pullCorpusTopics('other', 'token')).rejects.toThrow();
});
it('C3 reports a failed topics request with its HTTP status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 409 })));
  await expect(pullCorpusTopics('a', 'token')).rejects.toThrow('HTTP 409');
});
