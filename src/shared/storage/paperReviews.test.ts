import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import Dexie from 'dexie';
import { expect, it, vi } from 'vitest';
import { anchorReview, anchoringRate, mergePanel, panelSimilarity } from '@/core/reviewPanel';
import type { Paper, PaperReviewRun } from '@/core/schemas';
import { createDb } from './db';
import { createRepositories } from './repositories';

const at = '2026-01-01T00:00:00.000Z';
function fixture(): { paper: Paper; run: PaperReviewRun } {
  const paper: Paper = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: '',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: null, sha256: 'same' },
    sections: [{ id: 's', heading: '', role: 'methods', level: 1, pageStart: null }],
    paragraphs: [
      {
        id: 'p',
        sectionId: 's',
        order: 0,
        text: 'The detailed method was described for every reader.',
        kind: 'body',
        pageStart: null,
        textHash: 'x',
      },
    ],
  };
  const review = anchorReview(
    {
      lens: 'methods_skeptic',
      summary: '',
      points: [
        {
          kind: 'weakness',
          dimension: 'soundness',
          paragraphId: 'p',
          quote: paper.paragraphs[0]?.text ?? '',
          point: 'Cần mô tả chi tiết hơn về phương pháp này',
          rationale: 'Thiếu mô tả',
          severity: 'moderate',
          confidence: 0.8,
        },
      ],
      unanchored: [{ point: 'unanchored', reason: 'missing' }],
      cannotJudge: [],
    },
    paper,
    ['s'],
  );
  const reviews = [review],
    merged = mergePanel(reviews);
  return {
    paper,
    run: {
      id: crypto.randomUUID(),
      createdAt: at,
      lenses: ['methods_skeptic'],
      sectionIds: ['s'],
      promptVersion: 'paper-review-1',
      model: 'test',
      reviews,
      merged,
      metrics: {
        anchoring: anchoringRate(reviews),
        similarity: panelSimilarity(reviews),
        templates: [],
        agreement: { matching: 0, total: 1 },
      },
    },
  };
}
it('P5 migrates v7, gates reviews, preserves decisions, exports and deletes atomically', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const name = `review-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(7).stores({
    papers: 'id, updatedAt, title',
    paperOverviews: 'paperId',
    paperChecks: 'paperId',
    analyses: 'id, createdAt, updatedAt, text.sourceHash',
    auditEvents: 'id, analysisId, at',
    revisions: 'id, sourceAnalysisId, createdAt',
    generations: 'id, createdAt',
    paperRuns: 'id, paperId, updatedAt',
  });
  await old.open();
  const legacyPaper = fixture().paper;
  await old.table('papers').add(legacyPaper);
  old.close();
  const db = createDb(name),
    repo = createRepositories(db, () => new Date('2026-02-01T00:00:00Z'));
  const { paper, run } = fixture();
  expect(await repo.papers.get(legacyPaper.id)).toEqual(legacyPaper);
  await repo.papers.create(paper);
  const saved = await repo.paperReviews.saveRun(paper.id, run);
  const point = saved.runs[0]?.merged[0];
  if (!point) throw new Error('missing point');
  expect((await repo.paperReviews.getVisible(paper.id))?.runs).toEqual([]);
  await expect(repo.paperReviews.review(paper.id, point.id, 'confirmed_by_human')).rejects.toThrow();
  await repo.paperReviews.saveNotes(paper.id, 'Cần mô tả chi tiết hơn về phương pháp');
  expect((await repo.paperReviews.getVisible(paper.id))?.runs).toHaveLength(1);
  await repo.paperReviews.review(paper.id, point.id, 'dismissed_by_human', 'reviewed');
  const rerun = await repo.paperReviews.saveRun(paper.id, { ...run, id: crypto.randomUUID() });
  expect(rerun.decisions).toMatchObject([{ pointId: point.id, status: 'dismissed_by_human' }]);
  expect(await db.reviewNgrams.count()).toBeGreaterThan(0);
  expect(Object.keys((await db.reviewNgrams.toArray())[0] ?? {}).sort()).toEqual(['hash', 'paperId']);
  const data = await repo.transfer.exportAll('test');
  expect(data.paperReviews).toHaveLength(1);
  expect(data).not.toHaveProperty('reviewNgrams');
  const destDb = createDb(`review-dest-${crypto.randomUUID()}`),
    dest = createRepositories(destDb, () => new Date('2030-01-01T00:00:00Z'));
  const plan = await dest.transfer.previewImport(data);
  if (!plan.ok) throw new Error(plan.error);
  await dest.transfer.applyImport(plan);
  expect((await dest.paperReviews.get(paper.id))?.decisions).toMatchObject([{ pointId: point.id }]);
  expect(await destDb.reviewNgrams.count()).toBeGreaterThan(0);
  await dest.paperReviews.review(paper.id, point.id, 'candidate');
  const oldPlan = await dest.transfer.previewImport(data);
  if (!oldPlan.ok) throw new Error(oldPlan.error);
  await dest.transfer.applyImport(oldPlan);
  expect((await dest.paperReviews.get(paper.id))?.decisions).toEqual([]);
  const events = (await dest.audit.listByAnalysis(paper.id)).items;
  expect(events.filter((e) => e.action === 'run_review')).toHaveLength(2);
  expect(events.filter((e) => e.action === 'review_point')).toHaveLength(2);
  expect(events.filter((e) => e.action === 'save_notes')).toHaveLength(1);
  await dest.papers.delete(paper.id);
  expect(await dest.paperReviews.get(paper.id)).toBeUndefined();
  expect(await destDb.reviewNgrams.count()).toBe(0);
});
it('P5 reanchors imported reviews and suppresses forged locations', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const source = createRepositories(createDb(`review-source-${crypto.randomUUID()}`));
  const { paper, run } = fixture();
  await source.papers.create(paper);
  await source.paperReviews.saveRun(paper.id, run);
  const data = await source.transfer.exportAll('test');
  const point = data.paperReviews[0]?.runs[0]?.reviews[0]?.points[0];
  if (!point) throw new Error('missing point');
  point.quote = 'a quotation absent from the paper';
  point.anchor.start = 0;
  const dest = createRepositories(createDb(`review-forged-${crypto.randomUUID()}`));
  const plan = await dest.transfer.previewImport(data);
  if (!plan.ok) throw new Error(plan.error);
  await dest.transfer.applyImport(plan);
  const imported = await dest.paperReviews.get(paper.id);
  expect(imported?.runs[0]?.merged).toEqual([]);
  expect(imported?.runs[0]?.reviews[0]?.unanchored).toHaveLength(2);
});
it('P5 skipping notes reveals results and unanchored points cannot be reviewed', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`review-skip-${crypto.randomUUID()}`));
  const { paper, run } = fixture();
  await repo.papers.create(paper);
  await repo.paperReviews.saveRun(paper.id, run);
  await repo.paperReviews.saveNotes(paper.id, '', true);
  expect((await repo.paperReviews.getVisible(paper.id))?.runs).toHaveLength(1);
  await expect(repo.paperReviews.review(paper.id, 'unanchored', 'confirmed_by_human')).rejects.toThrow();
});
it('P5 imports four reviewed papers as one corpus and flags phrases from three other papers', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const source = createRepositories(createDb(`review-corpus-source-${crypto.randomUUID()}`));
  const papers: Paper[] = [];
  for (let i = 0; i < 4; i++) {
    const { paper, run } = fixture();
    papers.push(paper);
    await source.papers.create(paper);
    await source.paperReviews.saveRun(paper.id, run);
  }
  const data = await source.transfer.exportAll('test');
  const subsetIds = new Set(papers.slice(0, 3).map((paper) => paper.id));
  const subset = {
    ...data,
    papers: data.papers.filter((paper) => subsetIds.has(paper.id)),
    paperReviews: data.paperReviews.filter((record) => subsetIds.has(record.paperId)),
  };
  const three = createRepositories(createDb(`review-three-${crypto.randomUUID()}`));
  const threePlan = await three.transfer.previewImport(subset);
  if (!threePlan.ok) throw new Error(threePlan.error);
  await three.transfer.applyImport(threePlan);
  for (const paper of papers.slice(0, 3))
    expect((await three.paperReviews.get(paper.id))?.runs[0]?.metrics.templates).toEqual([]);
  const destDb = createDb(`review-corpus-dest-${crypto.randomUUID()}`);
  const dest = createRepositories(destDb);
  const plan = await dest.transfer.previewImport(data);
  if (!plan.ok) throw new Error(plan.error);
  await dest.transfer.applyImport(plan);
  for (const paper of papers) {
    const flags = (await dest.paperReviews.get(paper.id))?.runs[0]?.metrics.templates ?? [];
    expect(flags.some((item) => item.phrase === 'cần mô tả chi tiết hơn về')).toBe(true);
  }
  expect(
    (await destDb.reviewNgrams.toArray()).every(
      (item) => Object.keys(item).sort().join(',') === 'hash,paperId',
    ),
  ).toBe(true);
});
it('P5 migrates an unambiguous old decision id when a review is rebuilt', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const source = createRepositories(createDb(`review-old-id-${crypto.randomUUID()}`));
  const { paper, run } = fixture();
  await source.papers.create(paper);
  const saved = await source.paperReviews.saveRun(paper.id, run);
  const point = saved.runs[0]?.merged[0];
  if (!point) throw new Error('missing point');
  await source.paperReviews.saveNotes(paper.id, '', true);
  await source.paperReviews.review(paper.id, point.id, 'confirmed_by_human');
  const data = await source.transfer.exportAll('test');
  const record = data.paperReviews[0];
  if (!record || !record.decisions[0]) throw new Error('missing decision');
  record.decisions[0].pointId = JSON.stringify([
    point.lenses,
    point.anchor.paragraphId,
    point.anchor.start,
    point.anchor.end,
  ]);
  const dest = createRepositories(createDb(`review-old-id-dest-${crypto.randomUUID()}`));
  const plan = await dest.transfer.previewImport(data);
  if (!plan.ok) throw new Error(plan.error);
  await dest.transfer.applyImport(plan);
  expect((await dest.paperReviews.get(paper.id))?.decisions[0]?.pointId).toBe(point.id);
});
it('P5 preserves independent decisions for points from the same lens and quotation across reruns', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`review-distinct-${crypto.randomUUID()}`));
  const { paper, run } = fixture();
  const review = run.reviews[0];
  const point = review?.points[0];
  if (!review || !point) throw new Error('missing fixture');
  const reviews = [{ ...review, points: [point, { ...point, point: 'Một nhận xét khác' }] }];
  const input = { ...run, reviews, merged: mergePanel(reviews) };
  await repo.papers.create(paper);
  const saved = await repo.paperReviews.saveRun(paper.id, input);
  await repo.paperReviews.saveNotes(paper.id, '', true);
  const points = saved.runs[0]?.merged ?? [];
  const first = points[0],
    second = points[1];
  if (!first || !second) throw new Error('missing points');
  await repo.paperReviews.review(paper.id, first.id, 'confirmed_by_human');
  await repo.paperReviews.review(paper.id, second.id, 'dismissed_by_human');
  const rerun = await repo.paperReviews.saveRun(paper.id, {
    ...input,
    id: crypto.randomUUID(),
    reviews: [{ ...review, points: [...reviews[0]!.points].reverse() }],
  });
  expect(rerun.decisions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ pointId: first.id, status: 'confirmed_by_human' }),
      expect.objectContaining({ pointId: second.id, status: 'dismissed_by_human' }),
    ]),
  );
  expect(rerun.runs[1]?.merged.map((item) => item.id)).toEqual(points.map((item) => item.id));
});
