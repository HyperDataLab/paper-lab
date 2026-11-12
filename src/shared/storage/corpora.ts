import { CorpusSchema, type Corpus } from '@/core/schemas/corpus';
import type { ParagraphDb } from './db';
export function createCorporaRepository(db: ParagraphDb) {
  const corpora = {
    async syncState(id: string) {
      return db.corpusSync.get(id);
    },
    async setSyncState(id: string, version: string, corpus: Corpus) {
      await db.corpusSync.put({ id, version, snapshot: JSON.stringify(CorpusSchema.parse(corpus)) });
    },
    async replaceSynced(corpus: Corpus, version: string, expected: Corpus | undefined) {
      return db.transaction('rw', db.corpora, db.corpusSync, async () => {
        const current = await db.corpora.get(corpus.id);
        if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
        const value = CorpusSchema.parse(corpus);
        await db.corpora.put(value);
        await db.corpusSync.put({ id: value.id, version, snapshot: JSON.stringify(value) });
        return true;
      });
    },
    async get(id: string) {
      const row = await db.corpora.get(id);
      return row ? CorpusSchema.parse(row) : undefined;
    },
    async list() {
      return (await db.corpora.orderBy('updatedAt').reverse().toArray()).map((row) =>
        CorpusSchema.parse(row),
      );
    },
    async save(input: Corpus) {
      const value = CorpusSchema.parse(input);
      await db.corpora.put(value);
      return value;
    },
    async delete(id: string) {
      await db.transaction('rw', db.corpora, db.corpusProfiles, async () => {
        await db.corpora.delete(id);
        await db.corpusProfiles.delete(id);
      });
    },
  };
  return corpora;
}
