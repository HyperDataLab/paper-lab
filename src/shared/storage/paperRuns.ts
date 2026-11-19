import { PaperRunSchema, type PaperRun } from '@/core/schemas';
import type { StorageDeps } from './storageShared';
import type { DocStore } from './docStore';
export function createPaperRunsRepository(store: DocStore, deps: StorageDeps) {
  const { makeAudit } = deps;
  const paperRuns = {
    async create(input: PaperRun) {
      const value = PaperRunSchema.parse(input);
      await store.unitOfWork(async (tx) => {
        await tx.put('paperRuns', value.id, value, null);
        const audit = makeAudit(value.paperId, 'start_run', 'system');
        await tx.put('auditEvents', audit.id, audit, null);
      });
      return value;
    },
    async get(id: string) {
      const row = await store.get('paperRuns', id);
      return row ? PaperRunSchema.parse(row.doc) : undefined;
    },
    async listByPaper(paperId: string) {
      return (await store.query('paperRuns', { where: { paperId } }))
        .map((row) => PaperRunSchema.parse(row.doc))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async save(input: PaperRun) {
      const value = PaperRunSchema.parse(input);
      await store.unitOfWork(async (tx) => {
        const row = await tx.get('paperRuns', value.id);
        const previous = row ? PaperRunSchema.parse(row.doc) : undefined;
        if (!previous || previous.paperId !== value.paperId) throw new Error('Run not found');
        await tx.put('paperRuns', value.id, value);
        if (value.status === 'done' && previous.status !== 'done') {
          const audit = makeAudit(value.paperId, 'finish_run', 'system');
          await tx.put('auditEvents', audit.id, audit, null);
        }
      });
      return value;
    },
  };
  return paperRuns;
}
