import { PaperContextRecordSchema, type PaperContextRecordInput } from '@/core/schemas';
import type { DocStore } from './docStore';
export function createPaperContextRepository(store: DocStore) {
  const paperContext = {
    async get(paperId: string) {
      const row = await store.get('paperContext', paperId);
      return row ? PaperContextRecordSchema.parse(row.doc) : undefined;
    },
    async list() {
      return (await store.query('paperContext')).map((row) => PaperContextRecordSchema.parse(row.doc));
    },
    async save(input: PaperContextRecordInput) {
      const value = PaperContextRecordSchema.parse(input);
      await store.put('paperContext', value.paperId, value);
      return value;
    },
  };
  return paperContext;
}
