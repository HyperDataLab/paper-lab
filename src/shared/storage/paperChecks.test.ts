import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import Dexie from 'dexie';
import { expect, it, vi } from 'vitest';
import { runPaperChecks } from '@/core/paperChecks';
import type { Paper } from '@/core/schemas';
import { createDb } from './db';
import { createRepositories } from './repositories';

it('P4 migrates, preserves decisions across runs, exports, resolves newer changes and deletes', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const name = `checks-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(6).stores({
    papers: 'id, updatedAt, title',
    paperOverviews: 'paperId',
    analyses: 'id, createdAt, updatedAt, text.sourceHash',
    auditEvents: 'id, analysisId, at',
    revisions: 'id, sourceAnalysisId, createdAt',
    generations: 'id, createdAt',
    paperRuns: 'id, paperId, updatedAt',
  });
  await old.open();
  old.close();
  const db = createDb(name),
    repo = createRepositories(db);
  const at = '2026-01-01T00:00:00.000Z';
  const paper: Paper = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: '',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
    sections: [{ id: 's', heading: '', role: 'results', level: 1, pageStart: null }],
    paragraphs: [
      {
        id: 'p',
        sectionId: 's',
        order: 0,
        text: 'See Figure 1.',
        kind: 'body',
        pageStart: null,
        textHash: '',
      },
    ],
  };
  await repo.papers.create(paper);
  const report = runPaperChecks(paper, new Date(at));
  const finding = report.checks.flatMap((c) => c.findings)[0];
  if (!finding) throw new Error('Missing finding');
  const record = { schemaVersion: 1 as const, paperId: paper.id, report, decisions: [] };
  await repo.paperChecks.save(record);
  await repo.paperChecks.review(paper.id, finding.id, 'confirmed_by_human', 'Checked');
  expect((await repo.paperChecks.save(record)).decisions[0]?.status).toBe('confirmed_by_human');
  const data = await repo.transfer.exportAll('1');
  const dest = createRepositories(createDb(`checks-${crypto.randomUUID()}`));
  const plan = await dest.transfer.previewImport(data);
  if (!plan.ok) throw new Error(plan.error);
  await dest.transfer.applyImport(plan);
  expect((await dest.paperChecks.get(paper.id))?.decisions[0]?.status).toBe('confirmed_by_human');
  await dest.paperChecks.review(paper.id, finding.id, 'candidate');
  const oldPlan = await dest.transfer.previewImport(data);
  if (!oldPlan.ok) throw new Error(oldPlan.error);
  await dest.transfer.applyImport(oldPlan);
  expect((await dest.paperChecks.get(paper.id))?.decisions).toEqual([]);
  expect((await dest.audit.listByAnalysis(paper.id)).items.some((e) => e.action === 'review_check')).toBe(
    true,
  );
  await dest.papers.delete(paper.id);
  expect(await dest.paperChecks.get(paper.id)).toBeUndefined();
});
