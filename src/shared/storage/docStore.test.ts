import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newProject } from '@/core/extraction';
import { emptyResearchDesign } from '@/core/schemas/researchDesign';
import { createDb } from './db';
import { DexieDocStore } from './dexieDocStore';
import { MemoryDocStore, type DocStore } from './docStore';
import { AutoResearchConflictError, ResearchDesignConflictError, StorageConflictError } from './errors';
import { createRepositories } from './repositories';
import { testRepositories } from './testRepositories';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));

const at = '2026-11-19T00:00:00.000Z';
const run = (id: string, projectId: string, createdAt: string, status = 'running') => ({
  id,
  projectId,
  createdAt,
  updatedAt: createdAt,
  status,
});

const stores: [string, () => DocStore][] = [
  ['MemoryDocStore', () => new MemoryDocStore()],
  ['DexieDocStore', () => new DexieDocStore(createDb(`test-${crypto.randomUUID()}`))],
];

describe.each(stores)('%s contract', (_name, make) => {
  it('puts and gets documents with versions and guards', async () => {
    const store = make();
    expect(await store.get('autoresearchRuns', 'a')).toBeNull();
    const first = await store.put('autoresearchRuns', 'a', run('a', 'p1', at), null);
    const row = await store.get('autoresearchRuns', 'a');
    expect(row).toEqual({ doc: run('a', 'p1', at), version: first });
    await expect(store.put('autoresearchRuns', 'a', run('a', 'p1', at), null)).rejects.toBeInstanceOf(
      StorageConflictError,
    );
    await expect(store.put('autoresearchRuns', 'a', run('a', 'p1', at), first + 5)).rejects.toMatchObject({
      collection: 'autoresearchRuns',
      id: 'a',
      serverVersion: first,
    });
    const second = await store.put('autoresearchRuns', 'a', run('a', 'p2', at), first);
    expect(second).toBeGreaterThan(first);
    expect(await store.getMany('autoresearchRuns', ['a', 'missing'])).toEqual([
      { doc: run('a', 'p2', at), version: second },
      null,
    ]);
    await store.remove('autoresearchRuns', 'a', second);
    expect(await store.get('autoresearchRuns', 'a')).toBeNull();
  });

  it('queries by index with order, limit and summaries', async () => {
    const store = make();
    await store.put('autoresearchRuns', 'b', run('b', 'p1', '2026-01-02T00:00:00.000Z'));
    await store.put('autoresearchRuns', 'a', run('a', 'p1', '2026-01-01T00:00:00.000Z'));
    await store.put('autoresearchRuns', 'c', run('c', 'p2', '2026-01-03T00:00:00.000Z'));
    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
    expect(ids(await store.query('autoresearchRuns', { where: { projectId: 'p1' } }))).toEqual(['a', 'b']);
    expect(ids(await store.query('autoresearchRuns', { orderBy: 'createdAt', desc: true }))).toEqual([
      'c',
      'b',
      'a',
    ]);
    expect(ids(await store.query('autoresearchRuns', { orderBy: 'createdAt', limit: 1 }))).toEqual(['a']);
    const [summary] = await store.query('autoresearchRuns', {
      where: { projectId: 'p2' },
      select: 'summary',
    });
    expect(summary?.doc).toEqual({
      id: 'c',
      projectId: 'p2',
      status: 'running',
      createdAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    });
  });

  it('commits a unit of work at once, sees its own writes, and drops everything on error', async () => {
    const store = make();
    await store.put('autoresearchRuns', 'a', run('a', 'p1', at));
    const seen = await store.unitOfWork(async (tx) => {
      await tx.put('autoresearchRuns', 'b', run('b', 'p1', at), null);
      await tx.remove('autoresearchRuns', 'a');
      return (await tx.query('autoresearchRuns', { where: { projectId: 'p1' } })).map((row) => row.id);
    });
    expect(seen).toEqual(['b']);
    expect(await store.get('autoresearchRuns', 'a')).toBeNull();
    await expect(
      store.unitOfWork(async (tx) => {
        await tx.put('autoresearchRuns', 'c', run('c', 'p1', at));
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    expect(await store.get('autoresearchRuns', 'c')).toBeNull();
  });
});

describe('MemoryDocStore conflicts', () => {
  it('retries a unit of work once when a read document changed, then gives up', async () => {
    const store = new MemoryDocStore();
    await store.put('autoresearchRuns', 'a', run('a', 'p1', at));
    let attempts = 0;
    await store.unitOfWork(async (tx) => {
      attempts++;
      const row = await tx.get('autoresearchRuns', 'a');
      if (attempts === 1) await store.put('autoresearchRuns', 'a', run('a', 'p1', at, 'waiting'));
      await tx.put('autoresearchRuns', 'a', { ...(row!.doc as object), status: 'ended' });
    });
    expect(attempts).toBe(2);
    expect((await store.get('autoresearchRuns', 'a'))?.doc).toMatchObject({ status: 'ended' });

    await expect(
      store.unitOfWork(async (tx) => {
        await tx.get('autoresearchRuns', 'a');
        await store.put('autoresearchRuns', 'a', run('a', 'p1', at));
        await tx.put('autoresearchRuns', 'a', run('a', 'p1', at, 'ended'));
      }),
    ).rejects.toMatchObject({ collection: 'autoresearchRuns', id: 'a' });
  });

  it('treats a new document matching a query as a conflict', async () => {
    const store = new MemoryDocStore();
    let attempts = 0;
    await store.unitOfWork(async (tx) => {
      attempts++;
      await tx.query('autoresearchRuns', { where: { projectId: 'p1' } });
      if (attempts === 1) await store.put('autoresearchRuns', 'x', run('x', 'p1', at));
    });
    expect(attempts).toBe(2);
  });
});

const repositories: [string, () => ReturnType<typeof createRepositories>][] = [
  ['MemoryDocStore', () => testRepositories()],
  ['DexieDocStore', () => createRepositories(createDb(`test-${crypto.randomUUID()}`))],
];

describe.each(repositories)('project repositories over %s', (_name, make) => {
  async function project(repo: ReturnType<typeof make>, paperId: string | null = null) {
    return repo.extraction.save({
      ...newProject({ id: crypto.randomUUID(), title: 'Project', researchQuestion: 'Why?', now: at }),
      paperId,
    });
  }

  it('finds a project by paper and lists newest first', async () => {
    const repo = make();
    const paperId = crypto.randomUUID();
    const first = await project(repo);
    const second = await project(repo, paperId);
    expect((await repo.extraction.forPaper(paperId))?.id).toBe(second.id);
    expect(await repo.extraction.forPaper(crypto.randomUUID())).toBeUndefined();
    expect((await repo.extraction.list()).map((item) => item.id)).toContain(first.id);
  });

  it('keeps one active AutoResearch run per project and removes runs with the project', async () => {
    const repo = make();
    const value = await project(repo);
    const created = await repo.autoresearch.create(value.id, 10);
    await expect(repo.autoresearch.create(value.id, 10)).rejects.toBeInstanceOf(AutoResearchConflictError);
    await expect(repo.autoresearch.create(crypto.randomUUID(), 10)).rejects.toThrow('Project not found');
    const saved = await repo.autoresearch.save(created);
    expect(saved.revision).toBe(created.revision + 1);
    await expect(repo.autoresearch.save(created)).rejects.toBeInstanceOf(StorageConflictError);
    expect((await repo.autoresearch.list(value.id)).map((item) => item.id)).toEqual([created.id]);
    await repo.extraction.remove(value.id);
    expect(await repo.autoresearch.list(value.id)).toEqual([]);
    expect(await repo.extraction.get(value.id)).toBeUndefined();
  });

  it('guards research design versions', async () => {
    const repo = make();
    const value = await project(repo);
    const design = emptyResearchDesign(value.id);
    const saved = await repo.researchDesigns.save(design, design.version);
    expect(saved.version).toBe(design.version + 1);
    await expect(repo.researchDesigns.save(design, design.version)).rejects.toBeInstanceOf(
      ResearchDesignConflictError,
    );
    expect((await repo.researchDesigns.get(value.id))?.version).toBe(saved.version);
    await repo.extraction.remove(value.id);
    expect(await repo.researchDesigns.get(value.id)).toBeUndefined();
  });
});
