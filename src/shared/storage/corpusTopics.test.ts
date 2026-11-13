import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { createDb } from './db';
import { createCorpusTopicsRepository } from './corpusTopics';

it('retains snapshots by corpus and keeps names attached to each snapshot', async () => {
  const db = createDb(`topics-${crypto.randomUUID()}`);
  const repo = createCorpusTopicsRepository(db);
  const snapshot = {
    format: 'paperlab-corpus-topics' as const,
    schemaVersion: 1 as const,
    snapshotId: 'one',
    createdAt: '2026-01-01T00:00:00Z',
    corpora: [
      { corpusId: 'a', kind: 'journal' as const, title: 'A' },
      { corpusId: 'b', kind: 'control' as const, title: 'B' },
    ],
    pipeline: {
      tag: 'test',
      embeddingModel: 'test',
      parameters: {},
      seed: 1,
      textSource: 'abstract' as const,
      openalexFetchedAt: '2026-01-01T00:00:00Z',
    },
    quality: { outlierShare: 0 },
    topics: [],
    members: [],
  };
  await repo.save(snapshot);
  await repo.save({ ...snapshot, snapshotId: 'two', createdAt: '2026-02-01T00:00:00Z' });
  expect((await repo.list('b')).map((item) => item.snapshotId)).toEqual(['two', 'one']);
  await expect(repo.save({ ...snapshot, pipeline: { ...snapshot.pipeline, seed: 2 } })).rejects.toThrow();
  await repo.saveName({
    schemaVersion: 1,
    snapshotId: 'one',
    topicId: 0,
    promptVersion: 'v1',
    candidateName: 'Candidate',
    candidateDescription: 'Description',
    name: 'Edited',
    description: 'Edited description',
  });
  expect(await repo.names('two')).toEqual([]);
  expect(await repo.names('one')).toMatchObject([{ name: 'Edited', promptVersion: 'v1' }]);
  await db.delete();
});
