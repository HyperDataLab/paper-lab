import { StoredCorpusProfileSchema, type StoredCorpusProfile } from '@/core/schemas/corpusProfile';
import type { ParagraphDb } from './db';

export function createCorpusProfilesRepository(db: ParagraphDb) {
  return {
    async get(id: string) {
      const row = await db.corpusProfiles.get(id);
      return row ? StoredCorpusProfileSchema.parse(row) : undefined;
    },
    async save(record: StoredCorpusProfile) {
      const value = StoredCorpusProfileSchema.parse(record);
      await db.corpusProfiles.put(value);
      return value;
    },
  };
}
