import { runSchema, type Run } from '@/core/autoresearch/record';
import { newRun } from '@/core/autoresearch/run';
import type { ParagraphDb } from './db';
import type { StorageDeps } from './storageShared';

export class AutoResearchConflictError extends Error {}

export function createAutoResearchRepository(db: ParagraphDb, { now, ids }: StorageDeps) {
  return {
    async list(projectId: string) {
      const rows = await db.autoresearchRuns.where('projectId').equals(projectId).sortBy('createdAt');
      return rows.reverse().map((run) => runSchema.parse(run));
    },
    async get(id: string) {
      const run = await db.autoresearchRuns.get(id);
      return run ? runSchema.parse(run) : null;
    },
    async create(projectId: string, maxCalls: number) {
      return db.transaction('rw', [db.autoresearchRuns, db.extractionProjects], async () => {
        if (!(await db.extractionProjects.get(projectId))) throw new Error('Project not found');
        const existing = await db.autoresearchRuns.where('projectId').equals(projectId).toArray();
        if (existing.some((run) => run.status !== 'ended'))
          throw new AutoResearchConflictError('An active run already exists');
        const run = runSchema.parse(newRun(projectId, ids(), maxCalls, now()));
        await db.autoresearchRuns.add(run);
        return run;
      });
    },
    async save(run: Run) {
      return db.transaction('rw', db.autoresearchRuns, async () => {
        const current = await db.autoresearchRuns.get(run.id);
        if (current?.revision !== run.revision || current.projectId !== run.projectId)
          throw new AutoResearchConflictError('AutoResearch run changed');
        const next = runSchema.parse({ ...run, revision: run.revision + 1, updatedAt: now() });
        await db.autoresearchRuns.put(next);
        return next;
      });
    },
  };
}
