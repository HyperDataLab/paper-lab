import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { mergeTransitions, transitionFindings } from '@/core/paperOverview';
import type { TransitionJudgement, TransitionPair } from '@/core/schemas';
import { createDb } from './db';
import { createRepositories } from './repositories';

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
  expect(db.verno).toBe(6);
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
