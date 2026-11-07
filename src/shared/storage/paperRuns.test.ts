import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createDb } from './db';
import { createRepositories } from './repositories';
import type { PaperRun } from '@/core/schemas';

it('P2 migrates v4, stores run checkpoints and excludes them from exports', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const name = `p2-migrate-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(4).stores({
    analyses: 'id, createdAt, updatedAt, text.sourceHash',
    auditEvents: 'id, analysisId, at',
    revisions: 'id, sourceAnalysisId, createdAt',
    generations: 'id, createdAt',
    papers: 'id, updatedAt, title',
  });
  await old.open();
  await old.table('papers').add({ id: 'existing', title: 'unchanged' });
  old.close();
  const db = createDb(name);
  expect(await db.papers.get('existing')).toEqual({ id: 'existing', title: 'unchanged' });
  await db.papers.delete('existing');
  const repo = createRepositories(db);
  const at = '2026-01-01T00:00:00.000Z';
  const run: PaperRun = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    paperId: crypto.randomUUID(),
    createdAt: at,
    updatedAt: at,
    status: 'idle',
    plan: {
      sectionIds: [],
      steps: [],
      budget: 0,
      paragraphs: [],
      skipped: [],
      calls: { syntax: 0, judge: 0, structure: 0, score: 0 },
      total: 0,
      withinBudget: true,
    },
    budget: 0,
    callsUsed: 0,
    promptVersions: {},
    model: 'm',
    items: [],
  };
  await repo.paperRuns.create(run);
  expect(await repo.paperRuns.get(run.id)).toEqual(run);
  expect(await repo.paperRuns.listByPaper(run.paperId)).toEqual([run]);
  await repo.paperRuns.save({ ...run, status: 'done' });
  expect((await repo.audit.listByAnalysis(run.paperId)).items.map((event) => event.action)).toEqual([
    'start_run',
    'finish_run',
  ]);
  expect(await repo.transfer.exportAll('1')).not.toHaveProperty('paperRuns');
});
