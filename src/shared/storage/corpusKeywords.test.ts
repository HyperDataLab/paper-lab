import { expect, it } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import { addFromDois, addFromLibrary } from '@/core/corpus/intake';
import { buildCorpusKeywords } from '@/core/corpusKeywords';
import { testRepositories } from './testRepositories';

const kw = (slug: string, score: number) => ({ id: `keywords/${slug}`, name: slug, score });

it('stores a corpus keyword collection and reads it back', async () => {
  const repo = testRepositories();
  expect(await repo.corpusKeywords.get('c')).toBeUndefined();
  const collection = buildCorpusKeywords({
    corpusId: 'c',
    memberIds: ['m1', 'm2'],
    papers: [
      { memberId: 'm1', year: 2020, keywords: [kw('alpha', 0.5), kw('beta', 0.4)] },
      { memberId: 'm2', year: null, keywords: [kw('alpha', 0.7)] },
    ],
    computedAt: '2026-11-18T00:00:00.000Z',
  });
  await repo.corpusKeywords.save(collection);
  expect(await repo.corpusKeywords.get('c')).toEqual(collection);
  await expect(repo.corpusKeywords.save({ ...collection, memberCount: -1 })).rejects.toThrow();
});

it('resolves member keywords from the library, by DOI, and from DOI-only fetches', async () => {
  const repo = testRepositories();
  const { added } = await repo.library.addDois(['10.1000/linked', '10.1000/bydoi']);
  const [linked, byDoi] = added;
  if (!linked || !byDoi) throw new Error('missing items');
  await repo.library.update(linked.id, { keywords: [kw('alpha', 0.9)], year: 2019 });
  let corpus = addFromLibrary(exampleCorpus(), [linked]).corpus;
  corpus = addFromDois(corpus, '10.1000/bydoi\n10.1000/nowhere\n10.1000/fetched').corpus;
  const first = await repo.corpusKeywords.memberKeywords(corpus);
  expect(first.papers).toEqual([
    { memberId: corpus.members[1]?.memberId, year: 2019, keywords: [kw('alpha', 0.9)] },
  ]);
  expect(first.withoutDoi).toBe(1);
  expect(first.missing.map((target) => [target.doi, target.libraryId])).toEqual([
    ['10.1000/bydoi', byDoi.id],
    ['10.1000/nowhere', null],
    ['10.1000/fetched', null],
  ]);
  for (const target of first.missing)
    await repo.corpusKeywords.saveFetched(target, target.doi === '10.1000/nowhere' ? [] : [kw('beta', 0.3)]);
  const second = await repo.corpusKeywords.memberKeywords(corpus);
  expect(second.missing).toEqual([]);
  expect(second.papers).toHaveLength(4);
  expect((await repo.library.get(byDoi.id))?.keywords).toEqual([kw('beta', 0.3)]);
  expect(await repo.library.list()).toHaveLength(2);
});
