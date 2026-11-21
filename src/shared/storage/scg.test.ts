import { expect, it } from 'vitest';
import type { ScgPaperRun } from '@/core/schemas';
import { MemoryDocStore } from './docStore';
import { testRepositories } from './testRepositories';

const at = '2026-01-01T00:00:00.000Z';
const P = '00000000-0000-4000-8000-0000000000a1';
const run = (paperId: string): ScgPaperRun => ({
  schemaVersion: 1,
  paperId,
  doi: '10.1/x',
  s2CorpusId: '42',
  s2CheckedAt: at,
  idBase: '42',
  promptVersion: 'a+b+c',
  promptVersions: { contributions: 'a', prerequisites: 'b', alignment: 'c' },
  requestedModel: 'm',
  model: 'm',
  status: 'complete',
  callsUsed: 3,
  dropped: { quotes: 1, contributions: 0, prerequisites: 0, references: 0, matches: 0 },
  contributions: [
    {
      id: '42.c0',
      name: 'Encoder',
      description: 'An encoder.',
      types: [{ type: 'models_or_architectures', explanation: 'A model.' }],
      sections: ['Method'],
      prerequisites: [],
      sourceSentenceKeys: ['abcdef0123456789#0'],
      review: 'candidate',
    },
  ],
  progress: { fingerprint: 'f', contributionBatches: {}, prerequisitesDone: [], alignmentDone: [] },
  reviewCarry: {},
  createdAt: at,
  updatedAt: at,
});

it('round trips SCG runs and deletes them with the paper', async () => {
  const store = new MemoryDocStore();
  const repo = testRepositories({ store, clock: () => new Date('2026-02-01T00:00:00.000Z') });
  await repo.scg.save(run(P));
  await repo.scg.save(run('q'));
  expect(await repo.scg.get(P)).toEqual(run(P));
  expect(await repo.scg.listByPapers(['missing', P])).toEqual([run(P)]);
  expect((await repo.scg.list()).map((item) => item.paperId).sort()).toEqual([P, 'q'].sort());
  await expect(repo.scg.save({ ...run(P), status: 'bad' as 'complete' })).rejects.toThrow();
  const reviewed = await repo.scg.setReview(P, { contributionId: '42.c0' }, 'accepted');
  expect(reviewed?.contributions[0]?.review).toBe('accepted');
  expect(reviewed?.updatedAt).toBe('2026-02-01T00:00:00.000Z');
  expect(await repo.scg.setReview('missing', { contributionId: '42.c0' }, 'accepted')).toBeUndefined();
  await store.put('papers', P, { id: P });
  await repo.papers.delete(P);
  expect(await repo.scg.get(P)).toBeUndefined();
  expect(await repo.scg.get('q')).toBeDefined();
});
