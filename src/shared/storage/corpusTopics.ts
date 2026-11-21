import {
  CorpusTopicsSchema,
  TopicNameSchema,
  type CorpusTopics,
  type TopicName,
} from '@/core/schemas/corpusTopics';
import type { DocStore } from './docStore';

export function createCorpusTopicsRepository(store: DocStore) {
  return {
    async save(snapshot: CorpusTopics) {
      const value = CorpusTopicsSchema.parse(snapshot);
      const existing = await store.get('corpusTopics', value.snapshotId);
      if (existing && JSON.stringify(CorpusTopicsSchema.parse(existing.doc)) !== JSON.stringify(value))
        throw new Error('Snapshot ID already exists with different contents');
      await store.put('corpusTopics', value.snapshotId, {
        ...value,
        corpusIds: value.corpora.map((corpus) => corpus.corpusId),
      });
      return value;
    },
    async list(corpusId: string) {
      // The registry carries each snapshot's corpus ids in its summary, not in an index.
      const summaries = await store.query('corpusTopics', { select: 'summary' });
      const ids = summaries
        .filter((row) => ((row.doc as { corpusIds?: string[] }).corpusIds ?? []).includes(corpusId))
        .map((row) => row.id);
      return (await store.getMany('corpusTopics', ids))
        .flatMap((row) => (row ? [CorpusTopicsSchema.parse(row.doc)] : []))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async names(snapshotId: string) {
      return (await store.query('topicNames', { where: { refId: snapshotId }, orderBy: 'topicId' })).map(
        (row) => TopicNameSchema.parse(row.doc),
      );
    },
    async saveName(record: TopicName) {
      const value = TopicNameSchema.parse(record);
      await store.put('topicNames', `${value.snapshotId}:${value.topicId}`, value);
      return value;
    },
  };
}
