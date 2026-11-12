import { PaperContextRecordSchema, type PaperContextRecordInput } from '@/core/schemas';
import type { ParagraphDb } from './db';
export function createPaperContextRepository(db: ParagraphDb) {
  const paperContext = {
    async get(paperId: string) {
      const row = await db.paperContext.get(paperId);
      return row ? PaperContextRecordSchema.parse(row) : undefined;
    },
    async list() {
      return (await db.paperContext.toArray()).map((row) => PaperContextRecordSchema.parse(row));
    },
    async save(input: PaperContextRecordInput) {
      const value = PaperContextRecordSchema.parse(input);
      await db.paperContext.put(value);
      return value;
    },
  };
  return paperContext;
}
