import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { mergeTransitions, transitionFindings } from '@/core/paperOverview';
import type { TransitionJudgement, TransitionPair } from '@/core/schemas';
import { createDb } from './db';
import { createRepositories } from './repositories';
import { planRun } from '@/core/batch';

it('P3 migrates version 5 and audits transition decisions retained on rerun', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const name = `overview-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(5).stores({
    analyses: 'id, createdAt, updatedAt, text.sourceHash',
    auditEvents: 'id, analysisId, at',
    revisions: 'id, sourceAnalysisId, createdAt',
    generations: 'id, createdAt',
    papers: 'id, updatedAt, title',
    paperRuns: 'id, paperId, updatedAt',
  });
  await old.open();
  const at = '2026-01-01T00:00:00.000Z';
  const paper = {
    schemaVersion: 1 as const,
    id: crypto.randomUUID(),
    title: '',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text' as const, fileName: '', pageCount: null, sha256: '' },
    sections: [],
    paragraphs: [],
  };
  await old.table('papers').add(paper);
  old.close();
  const db = createDb(name);
  const repo = createRepositories(db);
  expect(await repo.papers.get(paper.id)).toEqual(paper);
  expect(db.verno).toBe(7);
  const endpoint = {
    paragraphId: 'p1',
    analysisId: crypto.randomUUID(),
    span: { start: 0, end: 1 },
    quote: 'A',
    sentence: 'A',
  };
  const pair: TransitionPair = {
    pairId: 'p1->p2',
    sectionId: 's',
    sectionRole: 'methods',
    from: endpoint,
    to: { ...endpoint, paragraphId: 'p2' },
  };
  const judgement: TransitionJudgement = {
    pairId: pair.pairId,
    continuity: 'shift',
    discourseRelation: 'none',
    linked: false,
    measured: true,
    confidence: 0.9,
    rationale: 'Chuyển ý.',
  };
  const findings = transitionFindings([pair], [judgement]);
  const overview = await repo.paperOverviews.get(paper.id);
  if (!overview || !findings[0]) throw new Error('Missing overview or finding');
  await repo.paperOverviews.save({
    ...overview,
    transitions: {
      pairs: [pair],
      judgements: [judgement],
      findings,
      promptVersion: 'para-flow-1',
      model: 'fake',
      updatedAt: at,
    },
  });
  const reviewed = await repo.paperOverviews.reviewTransition(paper.id, findings[0].id, 'dismissed_by_human');
  const rerun = transitionFindings([pair], [judgement], reviewed.transitions?.findings);
  expect(rerun[0]?.status).toBe('dismissed_by_human');
  await repo.paperOverviews.save({
    ...reviewed,
    transitions: mergeTransitions(
      reviewed.transitions,
      {
        pairs: [pair],
        judgements: [judgement],
        findings: rerun,
        promptVersion: 'para-flow-1',
        model: 'fake',
      },
      '2026-02-01T00:00:00.000Z',
    ),
  });
  expect((await repo.paperOverviews.get(paper.id))?.transitions?.findings[0]?.status).toBe(
    'dismissed_by_human',
  );
  expect((await repo.audit.listByAnalysis(paper.id)).items).toMatchObject([
    {
      action: 'review_transition',
      issueId: findings[0].id,
      before: { status: 'candidate' },
      after: { status: 'dismissed_by_human' },
    },
  ]);
  expect((await repo.paperOverviews.get(paper.id))?.transitions?.judgements[0]).toMatchObject({
    available: false,
    stale: true,
  });
  db.close();
});

it('P3 imports newer transition reviews with their audit, but skips audits when their finding state is not imported', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const at = '2026-01-01T00:00:00.000Z';
  const paper = {
    schemaVersion: 1 as const,
    id: crypto.randomUUID(),
    title: '',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text' as const, fileName: '', pageCount: null, sha256: 'same' },
    sections: [],
    paragraphs: [],
  };
  const source = createRepositories(
    createDb(`overview-source-${crypto.randomUUID()}`),
    () => new Date('2026-02-01T00:00:00.000Z'),
  );
  const dest = createRepositories(
    createDb(`overview-dest-${crypto.randomUUID()}`),
    () => new Date('2026-03-01T00:00:00.000Z'),
  );
  const conflict = createRepositories(
    createDb(`overview-conflict-${crypto.randomUUID()}`),
    () => new Date('2026-03-01T00:00:00.000Z'),
  );
  await source.papers.create(paper);
  const endpoint = {
    paragraphId: 'p1',
    analysisId: crypto.randomUUID(),
    span: { start: 0, end: 1 },
    quote: 'A',
    sentence: 'A',
  };
  const pair: TransitionPair = {
    pairId: 'p1->p2',
    sectionId: 's',
    sectionRole: 'methods',
    from: endpoint,
    to: { ...endpoint, paragraphId: 'p2' },
  };
  const judgement: TransitionJudgement = {
    pairId: pair.pairId,
    continuity: 'shift',
    discourseRelation: 'none',
    linked: false,
    measured: true,
    confidence: 1,
    rationale: '',
  };
  const finding = transitionFindings([pair], [judgement])[0];
  const overview = await source.paperOverviews.get(paper.id);
  if (!overview || !finding) throw new Error('Missing fixture');
  await source.paperOverviews.save({
    ...overview,
    transitions: {
      pairs: [pair],
      judgements: [judgement],
      findings: [finding],
      promptVersion: 'para-flow-1',
      model: 'fake',
      updatedAt: at,
    },
  });
  const baseline = await source.transfer.exportAll('1');
  for (const repo of [dest, conflict]) {
    const plan = await repo.transfer.previewImport(baseline);
    if (!plan.ok) throw new Error(plan.error);
    await repo.transfer.applyImport(plan);
  }
  await source.paperOverviews.reviewTransition(paper.id, finding.id, 'confirmed_by_human');
  const reviewed = await source.transfer.exportAll('1');
  expect(reviewed.paperOverviews[0]?.transitions).toMatchObject({
    updatedAt: at,
    reviewedAt: '2026-02-01T00:00:00.000Z',
  });
  const sourceEvent = reviewed.auditEvents.find((event) => event.action === 'review_transition');
  if (!sourceEvent) throw new Error('Missing audit');
  const plan = await dest.transfer.previewImport(reviewed);
  if (!plan.ok) throw new Error(plan.error);
  await dest.transfer.applyImport(plan);
  expect((await dest.paperOverviews.get(paper.id))?.transitions?.findings[0]?.status).toBe(
    'confirmed_by_human',
  );
  expect((await dest.audit.listByAnalysis(paper.id)).items.some((event) => event.id === sourceEvent.id)).toBe(
    true,
  );
  await conflict.paperOverviews.reviewTransition(paper.id, finding.id, 'dismissed_by_human');
  const oldPlan = await conflict.transfer.previewImport(reviewed);
  if (!oldPlan.ok) throw new Error(oldPlan.error);
  await conflict.transfer.applyImport(oldPlan);
  expect((await conflict.paperOverviews.get(paper.id))?.transitions?.findings[0]?.status).toBe(
    'dismissed_by_human',
  );
  expect(
    (await conflict.audit.listByAnalysis(paper.id)).items.some((event) => event.id === sourceEvent.id),
  ).toBe(false);
  const missingFinding = {
    ...reviewed,
    paperOverviews: reviewed.paperOverviews.map((record) => ({
      ...record,
      transitions: record.transitions && {
        ...record.transitions,
        reviewedAt: '2026-04-01T00:00:00.000Z',
        findings: [],
      },
    })),
  };
  const missingPlan = await conflict.transfer.previewImport(missingFinding);
  if (!missingPlan.ok) throw new Error(missingPlan.error);
  await conflict.transfer.applyImport(missingPlan);
  expect(
    (await conflict.audit.listByAnalysis(paper.id)).items.some((event) => event.id === sourceEvent.id),
  ).toBe(false);
});

it('P3 deleting a paper removes only its runs and overview in the audited transaction', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const db = createDb(`overview-delete-${crypto.randomUUID()}`);
  const repo = createRepositories(db);
  const at = '2026-01-01T00:00:00.000Z';
  const base = {
    schemaVersion: 1 as const,
    title: '',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text' as const, fileName: '', pageCount: null, sha256: '' },
    sections: [],
    paragraphs: [],
  };
  const papers = [crypto.randomUUID(), crypto.randomUUID()].map((id) => ({ ...base, id }));
  for (const paper of papers) {
    await repo.papers.create(paper);
    const overview = await repo.paperOverviews.get(paper.id);
    if (!overview) throw new Error('Missing overview');
    await repo.paperOverviews.save(overview);
    const plan = planRun(paper, { sectionIds: [], steps: [], budget: 0 });
    await repo.paperRuns.create({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      paperId: paper.id,
      createdAt: at,
      updatedAt: at,
      status: 'idle',
      plan,
      budget: 0,
      callsUsed: 0,
      promptVersions: {},
      model: '',
      items: [],
    });
  }
  const [first, second] = papers;
  if (!first || !second) throw new Error('Missing paper');
  await repo.papers.delete(first.id);
  expect(await db.paperOverviews.get(first.id)).toBeUndefined();
  expect(await repo.paperRuns.listByPaper(first.id)).toHaveLength(0);
  expect(await db.paperOverviews.get(second.id)).toBeDefined();
  expect(await repo.paperRuns.listByPaper(second.id)).toHaveLength(1);
  expect((await repo.audit.listByAnalysis(first.id)).items.map((event) => event.action)).toContain(
    'delete_paper',
  );
  db.auditEvents.hook('creating', (_key, event) => {
    if (event.action === 'delete_paper') throw new Error('audit failure');
  });
  await expect(repo.papers.delete(second.id)).rejects.toThrow('audit failure');
  expect(await repo.papers.get(second.id)).toBeDefined();
  expect(await db.paperOverviews.get(second.id)).toBeDefined();
  expect(await repo.paperRuns.listByPaper(second.id)).toHaveLength(1);
  db.close();
});
