import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixtureRun } from '@/core/measurement/testFixture';
import { COLLECTIONS } from '@/core/storage/collections';
import { DataNotConfiguredError, StorageConflictError } from '../errors';
import { testId, testWorkerData } from '../remoteTestSupport';
import { createRepositories } from '../repositories';
import { PAPER_COLLECTIONS } from './paperCollections';
import { paper, paperBodies, paperRun } from './paperTestFixtures';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

it.each(PAPER_COLLECTIONS)('C0 RemoteDocStore contract for %s', async (collection) => {
  const worker = testWorkerData();
  const store = worker.connect();
  const definition = COLLECTIONS[collection];
  const doc = definition.schema.parse((await paperBodies())[collection]);
  const id = definition.key(doc);
  expect(await store.get(collection, id)).toBeNull();
  const first = await store.put(collection, id, doc, null);
  await expect(store.put(collection, id, doc, null)).rejects.toBeInstanceOf(StorageConflictError);
  await expect(store.put(collection, id, doc, first + 1)).rejects.toMatchObject({ serverVersion: first });
  expect(await store.getMany(collection, [id, 'missing', id])).toEqual([
    { doc, version: first },
    null,
    { doc, version: first },
  ]);
  const where = definition.index(doc);
  expect(await store.query(collection, { where, limit: 1, orderBy: 'id' })).toEqual([
    { id, doc, version: first },
  ]);
  expect(await store.query(collection, { where, select: 'summary' })).toMatchObject([{ id, version: first }]);

  const seen = await store.unitOfWork(async (tx) => {
    const before = await tx.get(collection, id);
    await tx.put(collection, id, doc, before?.version);
    return tx.get(collection, id);
  });
  expect(seen?.version).toBe(first + 1);
  await expect(
    store.unitOfWork(async (tx) => {
      await tx.remove(collection, id, first + 1);
      throw new Error('Abort');
    }),
  ).rejects.toThrow('Abort');
  expect(await store.get(collection, id)).toEqual({ doc, version: first + 1 });
  await store.remove(collection, id, first + 1);
  expect(await store.get(collection, id)).toBeNull();
});

function connect(worker: ReturnType<typeof testWorkerData>) {
  const remote = worker.connect();
  return { remote, repo: createRepositories(remote) };
}

it('C4 refuses paper writes on an unconfigured worker instead of keeping them in the browser', async () => {
  const worker = testWorkerData(false);
  const { repo } = connect(worker);
  await expect(repo.papers.create(paper)).rejects.toBeInstanceOf(DataNotConfiguredError);
  await expect(repo.papers.get(paper.id)).rejects.toBeInstanceOf(DataNotConfiguredError);
  const url = new URL(worker.requests[0]?.url ?? '');
  expect(url.pathname).toMatch(/\/commit$/u);
  expect(url.searchParams.get('projectId')).toBe(testId(1));
});

it('C3 batches collections with the same paper id and unlinks library rows after a remote delete', async () => {
  const worker = testWorkerData();
  const { repo } = connect(worker);
  {
    await repo.papers.create(paper);
    const context = await repo.paperContext.save({
      schemaVersion: 1,
      paperId: paper.id,
      checkedAt: paper.updatedAt,
      paperDoi: null,
      checked: 0,
      found: 0,
      retracted: [],
    });
    const {
      added: [item],
    } = await repo.library.addDois(['10.1000/synthetic']);
    if (!item) throw new Error('Library fixture missing');
    await repo.library.update(item.id, { paper_id: paper.id });
    worker.requests.length = 0;
    expect(
      await Promise.all([
        repo.papers.get(paper.id),
        repo.paperContext.get(paper.id),
        repo.stance.get(paper.id),
      ]),
    ).toEqual([paper, context, undefined]);
    expect(worker.requests.map(({ url }) => new URL(url).pathname)).toEqual(['/v1/data/batch-get']);
    await repo.papers.delete(paper.id);
    await repo.papers.delete(paper.id);
    expect(await repo.papers.get(paper.id)).toBeUndefined();
    expect(await repo.paperContext.get(paper.id)).toBeUndefined();
    expect(await repo.library.get(item.id)).toMatchObject({ paper_id: null });
    expect(
      (await repo.audit.listByAnalysis(paper.id)).items.filter(({ action }) => action === 'delete_paper'),
    ).toHaveLength(1);
  }
});

it('C3 stores large checkpoints in small bodies and flushes the latest calls and run state', async () => {
  const worker = testWorkerData();
  const { repo } = connect(worker);
  const reload = connect(worker);
  {
    await repo.papers.create(paper);
    const run = {
      ...paperRun(),
      items: Array.from({ length: 15 }, (_, i) => ({
        paragraphId: `p${i}`,
        textHash: 'synthetic',
        analysisId: null,
        status: 'failed' as const,
        stepsDone: [],
        calls: 1,
        error: 'Synthetic failure. '.repeat(5_000),
      })),
    };
    await repo.paperRuns.create(run);
    await repo.paperRuns.checkpoint({ ...run, status: 'running', callsUsed: 1 });
    await repo.paperRuns.checkpoint({ ...run, status: 'running', callsUsed: 2 });
    await repo.paperRuns.save({ ...run, status: 'done', callsUsed: 3 });

    await repo.measurements.saveRun(paper.id, fixtureRun());
    const pending = {
      sectionIds: ['met'],
      callsUsed: 2,
      checkpoint: {
        classification: {
          paper_type: 'EMPIRICAL' as const,
          rationale: 'A synthetic rationale.'.repeat(60_000),
          quotes: [],
        },
        units: {},
        link: null,
        findings: null,
        model: 'synthetic',
      },
    };
    await repo.measurements.checkpoints.checkpoint(paper.id, pending);
    await repo.measurements.checkpoints.checkpoint(paper.id, { ...pending, callsUsed: 3 });
    await repo.measurements.checkpoints.flush(paper.id);

    const commits = await Promise.all(
      worker.requests
        .filter(({ url }) => new URL(url).pathname.endsWith('/commit'))
        .map(
          (request) =>
            request.json() as Promise<{
              ops: { collection: string; body?: unknown }[];
            }>,
        ),
    );
    for (const commit of commits)
      for (const op of commit.ops)
        if (op.body !== undefined)
          expect(new TextEncoder().encode(JSON.stringify(op.body)).length).toBeLessThan(1024 * 1024);
    expect(
      commits.flatMap(({ ops }) => ops).filter(({ collection }) => collection === 'measurements'),
    ).toHaveLength(1);
    expect((await reload.repo.paperRuns.listByPaper(paper.id))[0]).toEqual({
      ...run,
      status: 'done',
      callsUsed: 3,
    });
    expect(await reload.repo.measurements.get(paper.id)).toMatchObject({
      pending: { ...pending, callsUsed: 3 },
      runs: [fixtureRun()],
    });
    expect((await reload.repo.audit.listByAnalysis(paper.id)).items.map(({ action }) => action)).toContain(
      'finish_run',
    );
  }
}, 15_000);

it('C3 imports a multi-batch paper backup before attaching the library item', async () => {
  const source = connect(testWorkerData());
  const target = connect(testWorkerData());
  {
    const backup = await source.repo.transfer.exportAll('synthetic');
    await source.repo.papers.create(paper);
    const {
      added: [item],
    } = await source.repo.library.addDois(['10.1000/synthetic']);
    if (!item) throw new Error('Library fixture missing');
    const library = await source.repo.library.update(item.id, { paper_id: paper.id });
    const generation = COLLECTIONS.generations.schema.parse((await paperBodies()).generations) as object;
    const raw = {
      ...backup,
      papers: [paper],
      library: [library],
      generations: Array.from({ length: 103 }, (_, i) => ({ ...generation, id: testId(100 + i) })),
    };
    const plan = await target.repo.transfer.previewImport(raw);
    if (!plan.ok) throw new Error(plan.error);
    await target.repo.transfer.applyImport(plan);
    expect(await target.repo.generations.list()).toHaveLength(103);
    expect(await target.repo.papers.get(paper.id)).toEqual(paper);
    expect((await target.repo.library.list())[0]?.paper_id).toBe(paper.id);
  }
});
