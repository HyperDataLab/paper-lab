import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixtureRun } from '@/core/measurement/testFixture';
import { COLLECTIONS } from '@/core/storage/collections';
import { CompositeDocStore } from '../compositeDocStore';
import { createDb } from '../db';
import { DexieDocStore } from '../dexieDocStore';
import { StorageConflictError } from '../errors';
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
  const db = createDb(`c3-${crypto.randomUUID()}`);
  const local = new DexieDocStore(db);
  const remote = worker.connect();
  const composite = new CompositeDocStore(local, remote);
  return {
    db,
    local,
    remote,
    composite,
    repo: createRepositories(db, undefined, undefined, composite, remote),
  };
}

it('C3 falls back to Dexie on the first routed unit of work and keeps its paper audit', async () => {
  const worker = testWorkerData(false);
  const { db, repo, composite, local } = connect(worker);
  try {
    await repo.papers.create(paper);
    await repo.paperRuns.create(paperRun());
    expect(composite.isFallback()).toBe(true);
    expect((await local.get('papers', paper.id))?.doc).toEqual(paper);
    expect(await repo.paperRuns.get(paperRun().id)).toEqual(paperRun());
    expect((await repo.audit.listByAnalysis(paper.id)).items.map(({ action }) => action)).toEqual([
      'import_paper',
      'start_run',
    ]);
    expect(worker.requests[0]?.url).toMatch(/\/commit$/u);
  } finally {
    await db.delete();
  }
});

it('C3 batches collections with the same paper id and unlinks only local library rows after a remote delete', async () => {
  const worker = testWorkerData();
  const { db, repo, local } = connect(worker);
  try {
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
    expect(await local.get('papers', paper.id)).toBeNull();
    await repo.papers.delete(paper.id);
    await repo.papers.delete(paper.id);
    expect(await repo.papers.get(paper.id)).toBeUndefined();
    expect(await repo.paperContext.get(paper.id)).toBeUndefined();
    expect(await repo.library.get(item.id)).toMatchObject({ paper_id: null });
    expect(
      (await repo.audit.listByAnalysis(paper.id)).items.filter(({ action }) => action === 'delete_paper'),
    ).toHaveLength(1);
  } finally {
    await db.delete();
  }
});

it('C3 stores large checkpoints in small bodies and flushes the latest calls and run state', async () => {
  const worker = testWorkerData();
  const { db, repo } = connect(worker);
  const reload = connect(worker);
  try {
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
        .filter(({ url }) => url.endsWith('/commit'))
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
  } finally {
    await db.delete();
    await reload.db.delete();
  }
}, 15_000);

it('C3 imports a multi-batch paper backup before attaching the local library item', async () => {
  const source = connect(testWorkerData());
  const target = connect(testWorkerData());
  try {
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
    expect(await target.local.get('papers', paper.id)).toBeNull();
  } finally {
    await source.db.delete();
    await target.db.delete();
  }
});
