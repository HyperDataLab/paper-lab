import {
  CorpusTopicsSchema,
  TopicNameSchema,
  type CorpusTopics,
  type TopicName,
} from '@/core/schemas/corpusTopics';
import type { ParagraphDb } from './db';

export function createCorpusTopicsRepository(db: ParagraphDb) {
  return {
    async save(snapshot: CorpusTopics) {
      const value = CorpusTopicsSchema.parse(snapshot);
      const existing = await db.corpusTopics.get(value.snapshotId);
      if (existing && JSON.stringify(CorpusTopicsSchema.parse(existing)) !== JSON.stringify(value))
        throw new Error('Snapshot ID already exists with different contents');
      await db.corpusTopics.put({ ...value, corpusIds: value.corpora.map((corpus) => corpus.corpusId) });
      return value;
    },
    async list(corpusId: string) {
      return (await db.corpusTopics.where('corpusIds').equals(corpusId).toArray())
        .map((row) => CorpusTopicsSchema.parse(row))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async names(snapshotId: string) {
      return (await db.topicNames.where('snapshotId').equals(snapshotId).toArray()).map((row) =>
        TopicNameSchema.parse(row),
      );
    },
    async saveName(record: TopicName) {
      const value = TopicNameSchema.parse(record);
      await db.topicNames.put(value);
      return value;
    },
  };
}
