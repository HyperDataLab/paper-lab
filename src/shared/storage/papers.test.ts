import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { createDb } from './db';
import { createRepositories } from './repositories';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
it('migrates version 3 and stores, exports and imports papers with audit', async () => {
  const name = `paper-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(3).stores({
    analyses: 'id, createdAt, updatedAt, text.sourceHash',
    auditEvents: 'id, analysisId, at',
    revisions: 'id, sourceAnalysisId, createdAt',
    generations: 'id, createdAt',
  });
  await old.open();
  await old.table('generations').add({ id: 'existing', createdAt: '2020-01-01T00:00:00.000Z' });
  old.close();
  const db = createDb(name);
  const repo = createRepositories(db);
  expect(await db.generations.get('existing')).toBeDefined();
  await db.generations.delete('existing');
  const at = new Date().toISOString();
  const paper = {
    schemaVersion: 1 as const,
    id: crypto.randomUUID(),
    title: 'Paper',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text' as const, fileName: 'a.txt', pageCount: null, sha256: 'hash' },
    sections: [],
    paragraphs: [],
  };
  await repo.papers.create(paper);
  expect(await repo.papers.list()).toEqual([paper]);
  const overview = await repo.paperOverviews.get(paper.id);
  if (!overview) throw new Error('Missing overview');
  await repo.paperOverviews.save(overview);
  const data = await repo.transfer.exportAll('1');
  expect(data.papers).toEqual([paper]);
  expect(data.paperOverviews).toEqual([overview]);
  const dest = createRepositories(createDb(`paper-${crypto.randomUUID()}`));
  const plan = await dest.transfer.previewImport(data);
  if (!plan.ok) throw new Error(plan.error);
  await dest.transfer.applyImport(plan);
  expect(await dest.papers.get(paper.id)).toEqual(paper);
  expect(await dest.paperOverviews.get(paper.id)).toEqual(overview);
  const legacy: Partial<typeof data> = { ...data };
  delete legacy.papers;
  delete legacy.paperOverviews;
  expect((await dest.transfer.previewImport(legacy)).ok).toBe(true);
  await repo.papers.delete(paper.id);
  expect(await repo.papers.get(paper.id)).toBeUndefined();
  expect((await repo.audit.listByAnalysis(paper.id)).items.map((e) => e.action)).toEqual([
    'import_paper',
    'delete_paper',
  ]);
});
it('imports newer paper role edits, skips old or different sources and rejects stale previews', async () => {
  const repo = createRepositories(createDb(`paper-conflicts-${crypto.randomUUID()}`));
  const at = '2024-01-01T00:00:00.000Z';
  const paper = {
    schemaVersion: 1 as const,
    id: crypto.randomUUID(),
    title: 'Paper',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text' as const, fileName: 'a.txt', pageCount: null, sha256: 'same' },
    sections: [{ id: 'sec1', heading: 'Example', role: 'other' as const, level: 1, pageStart: null }],
    paragraphs: [],
  };
  await repo.papers.create(paper);
  const data = await repo.transfer.exportAll('1');
  const newer = {
    ...paper,
    updatedAt: '2025-01-01T00:00:00.000Z',
    sections: [{ ...paper.sections[0], role: 'methods' as const }],
  };
  const plan = await repo.transfer.previewImport({ ...data, papers: [newer] });
  if (!plan.ok) throw new Error(plan.error);
  expect(plan.papersToUpdate).toHaveLength(1);
  await repo.transfer.applyImport(plan);
  expect((await repo.papers.get(paper.id))?.sections[0]?.role).toBe('methods');
  expect((await repo.audit.listByAnalysis(paper.id)).items.map((event) => event.action)).toContain('import');
  await expect(repo.transfer.applyImport(plan)).rejects.toThrow('Import preview is out of date');
  for (const incoming of [paper, newer]) {
    const old = await repo.transfer.previewImport({ ...data, papers: [incoming] });
    if (!old.ok) throw new Error(old.error);
    expect(old.papersToUpdate).toHaveLength(0);
    expect(old.skipped).toContainEqual({ id: paper.id, reason: 'not newer' });
  }
  const different = await repo.transfer.previewImport({
    ...data,
    papers: [
      { ...newer, updatedAt: '2026-01-01T00:00:00.000Z', source: { ...newer.source, sha256: 'different' } },
    ],
  });
  if (!different.ok) throw new Error(different.error);
  expect(different.skipped).toContainEqual({ id: paper.id, reason: 'source differs' });
  expect(different.papersToUpdate).toHaveLength(0);
});
