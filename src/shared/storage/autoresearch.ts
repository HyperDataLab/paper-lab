import { runSchema, type Run } from '@/core/autoresearch/record';
import { newRun } from '@/core/autoresearch/run';
import type { DocStore } from './docStore';
import { AutoResearchConflictError } from './errors';
import type { StorageDeps } from './storageShared';

export { AutoResearchConflictError } from './errors';

export function createAutoResearchRepository(store: DocStore, { now, ids }: StorageDeps) {
  return {
    async list(projectId: string) {
      const rows = await store.query('autoresearchRuns', { where: { projectId }, orderBy: 'createdAt' });
      return rows.reverse().map((row) => runSchema.parse(row.doc));
    },
    async get(id: string) {
      const row = await store.get('autoresearchRuns', id);
      return row ? runSchema.parse(row.doc) : null;
    },
    async create(projectId: string, maxCalls: number) {
      return store.unitOfWork(async (tx) => {
        if (!(await tx.get('extractionProjects', projectId))) throw new Error('Project not found');
        const existing = await tx.query('autoresearchRuns', { where: { projectId }, select: 'summary' });
        if (existing.some((row) => (row.doc as Run).status !== 'ended'))
          throw new AutoResearchConflictError('An active run already exists');
        const run = runSchema.parse(newRun(projectId, ids(), maxCalls, now()));
        await tx.put('autoresearchRuns', run.id, run, null);
        return run;
      });
    },
    async save(run: Run) {
      return store.unitOfWork(async (tx) => {
        const row = await tx.get('autoresearchRuns', run.id);
        const current = row?.doc as Run | undefined;
        if (current?.revision !== run.revision || current.projectId !== run.projectId)
          throw new AutoResearchConflictError('AutoResearch run changed', run.id, row?.version ?? null);
        if (current.status === 'ended' && run.status !== 'ended') {
          const projectRuns = await tx.query('autoresearchRuns', {
            where: { projectId: run.projectId },
            select: 'summary',
          });
          if (projectRuns.some((item) => item.id !== run.id && (item.doc as Run).status !== 'ended'))
            throw new AutoResearchConflictError('Another AutoResearch run is active');
        }
        const next = runSchema.parse({ ...run, revision: run.revision + 1, updatedAt: now() });
        await tx.put('autoresearchRuns', next.id, next);
        return next;
      });
    },
  };
}
