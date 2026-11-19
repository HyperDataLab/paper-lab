import { StoredCorpusProfileSchema, type StoredCorpusProfile } from '@/core/schemas/corpusProfile';
import type { DocStore } from './docStore';

export function createCorpusProfilesRepository(store: DocStore) {
  return {
    async get(id: string) {
      const row = await store.get('corpusProfiles', id);
      return row ? StoredCorpusProfileSchema.parse(row.doc) : undefined;
    },
    async save(record: StoredCorpusProfile) {
      const value = StoredCorpusProfileSchema.parse(record);
      await store.put('corpusProfiles', value.corpusId, value);
      return value;
    },
  };
}
