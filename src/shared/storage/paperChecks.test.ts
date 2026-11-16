import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import Dexie from 'dexie';
import { expect, it, vi } from 'vitest';
import { runPaperChecks } from '@/core/paperChecks';
import type { Paper } from '@/core/schemas';
import { createDb } from './db';
import { createRepositories } from './repositories';
import { grobidPaper, grobidResult } from '@/test/grobidFixtures';

it('retains reviewed GROBID findings and lists unmatched decisions through repeated saves', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`checks-grobid-${crypto.randomUUID()}`));
  await repo.papers.create(grobidPaper);
  const report = runPaperChecks(grobidPaper, new Date(), grobidResult);
  const findings = report.checks.flatMap((check) => check.findings);
  const unused = findings.find((finding) => finding.id.includes('unused:grobid:'));
  const missing = findings.find((finding) => finding.id.includes('missing:grobid:'));
  if (!unused || !missing) throw new Error('Expected synthetic findings');
  await repo.paperChecks.save({ schemaVersion: 1, paperId: grobidPaper.id, report, decisions: [] });
  await repo.paperChecks.review(grobidPaper.id, unused.id, 'dismissed_by_human', 'reviewed');
  const reviewed = await repo.paperChecks.review(grobidPaper.id, missing.id, 'confirmed_by_human');
  const next = {
    ...report,
    checks: report.checks.map((check) => ({
      ...check,
      findings: check.findings
        .filter((finding) => finding.id !== missing.id)
        .map((finding) => (finding.id === unused.id ? { ...finding, id: 'changed-id' } : finding)),
    })),
  };
  const saved = await repo.paperChecks.save({ ...reviewed, report: next });
  expect(saved.decisions).toEqual([expect.objectContaining({ findingId: 'changed-id', note: 'reviewed' })]);
  expect(saved.orphanedDecisions).toEqual([expect.objectContaining({ finding: missing })]);
  expect((await repo.paperChecks.save(saved)).orphanedDecisions).toEqual(saved.orphanedDecisions);
});

it('P4 imports unseen review_check audit history when the local rerun is newer and removed the finding', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const source = createRepositories(
    createDb(`checks-source-${crypto.randomUUID()}`),
    () => new Date('2026-02-01T00:00:00.000Z'),
  );
  const dest = createRepositories(
    createDb(`checks-dest-${crypto.randomUUID()}`),
    () => new Date('2030-01-01T00:00:00.000Z'),
  );
  const at = '2026-01-01T00:00:00.000Z';
  const paper: Paper = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: '',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: null, sha256: 'same' },
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
  await source.papers.create(paper);
  await dest.papers.create(paper);
  const report = runPaperChecks(paper, new Date(at));
  const finding = report.checks.flatMap((c) => c.findings)[0];
  if (!finding) throw new Error('Missing finding');
  await source.paperChecks.save({ schemaVersion: 1, paperId: paper.id, report, decisions: [] });
  await source.paperChecks.review(paper.id, finding.id, 'dismissed_by_human', 'Reviewed');
  const newer = {
    ...report,
    generatedAt: '2030-01-01T00:00:00.000Z',
    checks: report.checks.map((c) => ({ ...c, findings: [] })),
  };
  await dest.paperChecks.save({ schemaVersion: 1, paperId: paper.id, report: newer, decisions: [] });
  const data = await source.transfer.exportAll('1');
  for (let i = 0; i < 2; i++) {
    const plan = await dest.transfer.previewImport(data);
    if (!plan.ok) throw new Error(plan.error);
    await dest.transfer.applyImport(plan);
  }
  expect((await dest.paperChecks.get(paper.id))?.report).toEqual(newer);
  const reviews = (await dest.audit.listByAnalysis(paper.id)).items.filter(
    (e) => e.action === 'review_check',
  );
  expect(reviews).toHaveLength(1);
  expect(reviews[0]).toMatchObject({ issueId: finding.id, note: 'Reviewed' });
});

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
