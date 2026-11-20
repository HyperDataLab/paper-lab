import { expect, it } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import { testRepositories } from './testRepositories';

it('C1b corpus repository and export import round trip, including legacy packages', async () => {
  const source = testRepositories();
  const target = testRepositories();
  const corpus = exampleCorpus();
  await source.corpora.save(corpus);
  expect(await source.corpora.get(corpus.id)).toEqual(corpus);
  expect(await source.corpora.list()).toEqual([corpus]);
  const backup = await source.transfer.exportAll('test');
  const plan = await target.transfer.previewImport(backup);
  if (!plan.ok) throw new Error(plan.error);
  await target.transfer.applyImport(plan);
  expect(await target.corpora.get(corpus.id)).toEqual(corpus);
  const legacy = Object.fromEntries(
    Object.entries(backup).filter(([key]) => key !== 'corpora' && key !== 'corpusProfiles'),
  );
  const old = await target.transfer.previewImport(legacy);
  expect(old.ok && old.corpora).toEqual([]);
  expect(old.ok && old.corpusProfiles).toEqual([]);
  await target.corpora.delete(corpus.id);
  expect(await target.corpora.get(corpus.id)).toBeUndefined();
});
