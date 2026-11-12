import { PaperRunSchema, type PaperRun } from '@/core/schemas';
import type { StorageDeps } from './storageShared';
import type { ParagraphDb } from './db';
export function createPaperRunsRepository(db: ParagraphDb, deps: StorageDeps) {
  const { makeAudit } = deps;
  const paperRuns = {
    async create(input: PaperRun) {
      const value = PaperRunSchema.parse(input);
      await db.transaction('rw', db.paperRuns, db.auditEvents, async () => {
        await db.paperRuns.add(value);
        await db.auditEvents.add(makeAudit(value.paperId, 'start_run', 'system'));
      });
      return value;
    },
    async get(id: string) {
      const value = await db.paperRuns.get(id);
      return value ? PaperRunSchema.parse(value) : undefined;
    },
    async listByPaper(paperId: string) {
      return (await db.paperRuns.where('paperId').equals(paperId).toArray())
        .map((value) => PaperRunSchema.parse(value))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async save(input: PaperRun) {
      const value = PaperRunSchema.parse(input);
      await db.transaction('rw', db.paperRuns, db.auditEvents, async () => {
        const previous = await paperRuns.get(value.id);
        if (!previous || previous.paperId !== value.paperId) throw new Error('Run not found');
        await db.paperRuns.put(value);
        if (value.status === 'done' && previous.status !== 'done')
          await db.auditEvents.add(makeAudit(value.paperId, 'finish_run', 'system'));
      });
      return value;
    },
  };
  return paperRuns;
}
