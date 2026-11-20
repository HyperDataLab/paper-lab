import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newProject } from '@/core/extraction';
import { newRun } from '@/core/autoresearch/run';
import { CompositeDocStore } from './compositeDocStore';
import { createDb } from './db';
import { DexieDocStore } from './dexieDocStore';
import type { DocTx } from './docStore';
import { MixedStorageError, StorageConflictError } from './errors';
import { RemoteDocStore } from './remoteDocStore';
import { testId, testWorkerData } from './remoteTestSupport';

const projectId = testId(1);
const at = '2026-11-09T00:00:00.000Z';
const collection = 'extractionProjects';
const project = newProject({ id: projectId, title: 'Project', researchQuestion: '', now: at });

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('uses a conditional read when the cache is cold, then sends cached versions and surfaces stale writes', async () => {
  const worker = testWorkerData();
  const store = worker.connect();
  expect(await store.put(collection, projectId, project)).toBe(1);
  expect(worker.requests.map((request) => request.method)).toEqual(['GET', 'PUT']);
  expect(worker.requests[1]?.headers.get('If-None-Match')).toBe('*');
  expect(await store.put(collection, projectId, { ...project, title: 'Second' })).toBe(2);
  expect(worker.requests[2]?.headers.get('If-Match')).toBe('"v1"');
  await worker.connect().put(collection, projectId, { ...project, title: 'Other tab' }, 2);
  await expect(store.put(collection, projectId, project)).rejects.toMatchObject({
    collection,
    id: projectId,
    serverVersion: 3,
  });
  expect((await store.get(collection, projectId))?.doc).toMatchObject({ title: 'Other tab' });
  await store.get(collection, projectId);
  expect(worker.requests.at(-1)?.headers.get('If-None-Match')).toBe('"v3"');
});

it('retries a conflicting commit once and never applies writes from a failed batch', async () => {
  const worker = testWorkerData();
  const store = worker.connect();
  const other = worker.connect();
  await store.put(collection, projectId, project);
  const runId = testId(2);
  const fn = vi.fn(async (tx: DocTx) => {
    const row = await tx.get(collection, projectId);
    await tx.put('autoresearchRuns', runId, newRun(projectId, runId, 5, at), null);
    await other.put(collection, projectId, project, row?.version);
    await tx.put(collection, projectId, { ...project, title: 'Stale' });
  });
  await expect(store.unitOfWork(fn)).rejects.toBeInstanceOf(StorageConflictError);
  expect(fn).toHaveBeenCalledTimes(2);
  expect(await store.get('autoresearchRuns', runId)).toBeNull();
  expect((await store.get(collection, projectId))?.doc).toMatchObject({ title: 'Project' });
  expect(worker.requests.filter((request) => request.url.endsWith('/commit'))).toHaveLength(2);
});

it('retries when a matching row is inserted between the query and commit', async () => {
  const worker = testWorkerData();
  const store = worker.connect();
  const other = worker.connect();
  const runId = testId(2);
  let attempts = 0;
  const count = await store.unitOfWork(async (tx) => {
    const rows = await tx.query('autoresearchRuns', { where: { projectId }, select: 'summary' });
    if (++attempts === 1) await other.put('autoresearchRuns', runId, newRun(projectId, runId, 5, at), null);
    return rows.length;
  });
  expect(attempts).toBe(2);
  expect(count).toBe(1);
});

it('coalesces checkpoints through an in-flight PUT and flushes the newest state at the two-second boundary', async () => {
  vi.useFakeTimers();
  const worker = testWorkerData();
  const starts: number[] = [];
  const uploads: string[] = [];
  let markStarted = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = worker.connect(async (input, init) => {
    if (init?.method === 'PUT') {
      starts.push(Date.now());
      const body = JSON.parse(String(init.body)) as { title: string };
      uploads.push(body.title);
      if (uploads.length === 1) {
        markStarted();
        await gate;
      }
    }
    return worker.dispatch(input, init);
  });
  await store.checkpoint(collection, projectId, () => project);
  await started;
  await store.checkpoint(collection, projectId, () => ({ ...project, title: 'Discarded intermediate' }));
  await store.checkpoint(collection, projectId, () => ({ ...project, title: 'Latest' }));
  expect(store.getSaveStatus()).toBe('saving');
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);
  const flush = store.flush();
  await vi.advanceTimersByTimeAsync(1999);
  expect(uploads).toEqual(['Project']);
  release();
  await vi.advanceTimersByTimeAsync(1);
  await flush;
  expect(uploads).toEqual(['Project', 'Latest']);
  expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(2000);
  expect(store.getSaveStatus()).toBe('idle');
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
  expect((await store.get(collection, projectId))?.doc).toMatchObject({ title: 'Latest' });
});

it('picks the latest checkpoint when token refresh delays a PUT', async () => {
  const worker = testWorkerData();
  let giveToken = (_token: string) => {};
  const token = new Promise<string>((resolve) => {
    giveToken = resolve;
  });
  let calls = 0;
  const store = new RemoteDocStore({
    baseUrl: 'https://worker.test',
    fetch: worker.dispatch,
    getToken: async () => (++calls === 2 ? token : 'lab-test'),
  });
  await store.checkpoint(collection, projectId, () => project);
  await store.checkpoint(collection, projectId, () => ({ ...project, title: 'Queued during refresh' }));
  giveToken('lab-test');
  await store.flush();
  const puts = worker.requests.filter((request) => request.method === 'PUT');
  expect(puts).toHaveLength(1);
  expect(await puts[0]?.json()).toMatchObject({ title: 'Queued during refresh' });
});

it('retains an unsaved checkpoint after a failed PUT and retries it on the next flush', async () => {
  vi.useFakeTimers();
  const worker = testWorkerData();
  let failed = false;
  const store = worker.connect(async (input, init) => {
    if (init?.method === 'PUT' && !failed) {
      failed = true;
      return Response.json({ error: 'internal' }, { status: 500 });
    }
    return worker.dispatch(input, init);
  });
  await store.checkpoint(collection, projectId, () => project);
  await expect(store.flush()).rejects.toMatchObject({ status: 500 });
  expect(store.getSaveStatus()).toBe('error');
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);
  const retry = store.flush();
  await vi.advanceTimersByTimeAsync(2000);
  await retry;
  expect(store.getSaveStatus()).toBe('idle');
  expect((await store.get(collection, projectId))?.doc).toEqual(project);
});

it('keeps browser and lab units of work separate and uses Dexie for an unconfigured worker', async () => {
  const db = createDb(`c2-${crypto.randomUUID()}`);
  const local = new DexieDocStore(db);
  const online = new CompositeDocStore(local, testWorkerData().connect());
  await expect(
    online.unitOfWork(
      async (tx) => {
        await tx.put(collection, projectId, project, null);
        await tx.get('library', 'anything');
      },
      [collection],
    ),
  ).rejects.toBeInstanceOf(MixedStorageError);
  expect(await online.get(collection, projectId)).toBeNull();
  expect(await local.get(collection, projectId)).toBeNull();
  const worker = testWorkerData(false);
  const composite = new CompositeDocStore(local, worker.connect());
  await composite.put(collection, projectId, project, null);
  expect(composite.isFallback()).toBe(true);
  expect((await local.get(collection, projectId))?.doc).toEqual(project);
  expect((await composite.get(collection, projectId))?.doc).toEqual(project);
  expect(worker.requests).toHaveLength(1);
});

it('orders audit and topic rows by body fields and batches index membership with cursor paging', async () => {
  const { dispatch } = testWorkerData();
  const request = (path: string, body: object) =>
    dispatch(`https://worker.test/v1/data/${path}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer lab-test' },
      body: JSON.stringify(body),
    });
  const audit = (id: string, at: string) => ({
    schemaVersion: 1,
    id,
    analysisId: projectId,
    actor: 'human',
    action: 'review_extraction',
    at,
    issueId: null,
    before: null,
    after: null,
    note: null,
  });
  const names = [10, 2].map((topicId) => ({
    schemaVersion: 1,
    snapshotId: 'snapshot',
    topicId,
    promptVersion: 'test',
    candidateName: `Topic ${topicId}`,
    candidateDescription: '',
    name: null,
    description: null,
  }));
  expect(
    (
      await request('commit', {
        ops: [
          ...[audit(testId(8), '2026-11-02T00:00:00.000Z'), audit(testId(9), at)].map((body) => ({
            collection: 'auditEvents',
            id: body.id,
            body,
            op: 'put',
            expectedVersion: null,
          })),
          ...names.map((body) => ({
            collection: 'topicNames',
            id: `snapshot:${body.topicId}`,
            body,
            op: 'put',
            expectedVersion: null,
          })),
        ],
      })
    ).status,
  ).toBe(200);
  const base = {
    collection: 'auditEvents',
    orderBy: 'at',
    desc: true,
    limit: 1,
    whereIn: { field: 'refId', values: Array.from({ length: 130 }, (_, i) => testId(i + 1)) },
  };
  const first = (await (await request('query', base)).json()) as {
    items: { id: string }[];
    nextCursor: string;
  };
  expect(first.items.map(({ id }) => id)).toEqual([testId(9)]);
  const next = (await (await request('query', { ...base, cursor: first.nextCursor })).json()) as typeof first;
  expect(next.items.map(({ id }) => id)).toEqual([testId(8)]);
  const topics = (await (
    await request('query', { collection: 'topicNames', orderBy: 'topicId' })
  ).json()) as typeof first;
  expect(topics.items.map(({ id }) => id)).toEqual(['snapshot:2', 'snapshot:10']);
});
