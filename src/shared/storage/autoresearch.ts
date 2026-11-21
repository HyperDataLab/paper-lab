import { runSchema, type Run } from '@/core/autoresearch/record';
import { newRun } from '@/core/autoresearch/run';
import type { DocStore } from './docStore';
import { AutoResearchConflictError, StorageConflictError } from './errors';
import type { StorageDeps } from './storageShared';

export { AutoResearchConflictError } from './errors';

export function createAutoResearchRepository(store: DocStore, { now, ids }: StorageDeps) {
  const collection = 'autoresearchRuns';
  async function withConflict<T>(id: string, action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof StorageConflictError) || error instanceof AutoResearchConflictError) throw error;
      throw new AutoResearchConflictError(
        error.message,
        error.collection === collection ? error.id || id : id,
        typeof error.serverVersion === 'number' ? error.serverVersion : null,
      );
    }
  }
  function check(run: Run, doc: unknown, version: number | null = null) {
    const current = doc as Run | undefined;
    if (current?.revision !== run.revision || current.projectId !== run.projectId)
      throw new AutoResearchConflictError('AutoResearch run changed', run.id, version);
    return current;
  }
  const nextRun = (run: Run) => runSchema.parse({ ...run, revision: run.revision + 1, updatedAt: now() });
  async function save(run: Run) {
    return withConflict(run.id, () =>
      store.unitOfWork(
        async (tx) => {
          const row = await tx.get(collection, run.id);
          const current = check(run, row?.doc, row?.version);
          if (current.status === 'ended' && run.status !== 'ended') {
            const projectRuns = await tx.query(collection, {
              where: { projectId: run.projectId },
              select: 'summary',
            });
            if (projectRuns.some((item) => item.id !== run.id && (item.doc as Run).status !== 'ended'))
              throw new AutoResearchConflictError('Another AutoResearch run is active');
          }
          const next = nextRun(run);
          await tx.put(collection, next.id, next);
          return next;
        },
        [collection],
      ),
    );
  }
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
      return withConflict('', () =>
        store.unitOfWork(
          async (tx) => {
            if (!(await tx.get('extractionProjects', projectId))) throw new Error('Project not found');
            const existing = await tx.query('autoresearchRuns', { where: { projectId }, select: 'summary' });
            if (existing.some((row) => (row.doc as Run).status !== 'ended'))
              throw new AutoResearchConflictError('An active run already exists');
            const run = runSchema.parse(newRun(projectId, ids(), maxCalls, now()));
            await tx.put('autoresearchRuns', run.id, run, null);
            return run;
          },
          ['extractionProjects', collection],
        ),
      );
    },
    save,
    checkpoint(run: Run) {
      return withConflict(run.id, async () => {
        if (!store.checkpoint) return save(run);
        return store.checkpoint(collection, run.id, (doc) => {
          // Stage start is a guarded save. Checkpoints can only continue that active run.
          if (check(run, doc).status === 'ended')
            throw new AutoResearchConflictError('AutoResearch run ended', run.id);
          return nextRun(run);
        });
      });
    },
    flush: (id: string) => withConflict(id, () => store.flush?.(collection, id) ?? Promise.resolve()),
    discard: (id: string) => store.discard?.(collection, id),
  };
}
