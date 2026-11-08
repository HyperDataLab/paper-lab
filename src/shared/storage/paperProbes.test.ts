import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { summariseProbe } from '@/core/probe';
import { buildAnalysisReport } from '@/core/report/buildAnalysisReport';
import { probeAt, probeFixture } from '@/test/probeFixtures';
import { createStyleProbeRun } from '@/shared/llm/llmStyleProbe';
import { createDb } from './db';
import { createRepositories } from './repositories';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
it('P6 migrates version 8 and saves, exports, imports and deletes probes with the paper', async () => {
  const name = `probe-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(8).stores({ papers: 'id, updatedAt, title', paperReviews: 'paperId' });
  await old.open();
  await old.table('paperReviews').add({ paperId: 'existing' });
  old.close();
  const db = createDb(name);
  expect(await db.paperReviews.get('existing')).toBeDefined();
  await db.paperReviews.delete('existing');
  const repo = createRepositories(db);
  const { paper, analyses } = await probeFixture();
  await repo.papers.create(paper);
  const run = createStyleProbeRun(paper, analyses, {
    n: 3,
    budget: 12,
    model: 'test',
    id: crypto.randomUUID(),
    now: probeAt,
  });
  const paragraph = paper.paragraphs.find((p) => p.id === run.paragraphIds[0]);
  const analysis = analyses.find((a) => a.id === run.analysisIds[0]);
  if (!paragraph || !analysis) throw new Error('fixture');
  const secret = 'AUDIT ONLY REWRITTEN PASSAGE';
  run.items.push({
    paragraphId: paragraph.id,
    sectionId: paragraph.sectionId,
    textHash: paragraph.textHash,
    analysisId: analysis.id,
    rewrittenText: secret,
    reasons: [],
    original: analysis.scores,
    rewritten: analysis.scores,
    baseline: analysis.scores,
  });
  run.summary = summariseProbe(run.items);
  await repo.paperProbes.saveRun(paper.id, run);
  await repo.paperProbes.saveRun(paper.id, { ...run, status: 'done' });
  const events = (await repo.audit.listByAnalysis(paper.id)).items;
  expect(events.filter((event) => event.action === 'run_probe')).toHaveLength(1);
  expect(
    JSON.stringify(
      buildAnalysisReport(analysis, { audit: events, revisions: [], generation: null, parent: null }),
    ),
  ).not.toContain(secret);
  const data = await repo.transfer.exportAll('1');
  expect(data.paperProbes[0]?.runs[0]?.items[0]?.rewrittenText).toBe(secret);
  const dest = createRepositories(createDb(`probe-dest-${crypto.randomUUID()}`));
  const plan = await dest.transfer.previewImport(data);
  if (!plan.ok) throw new Error(plan.error);
  await dest.transfer.applyImport(plan);
  expect(await dest.paperProbes.get(paper.id)).toEqual(data.paperProbes[0]);
  const newer = { ...data.paperProbes[0], updatedAt: '2099-01-01T00:00:00.000Z', runs: [] };
  const next = await dest.transfer.previewImport({ ...data, paperProbes: [newer] });
  if (!next.ok) throw new Error(next.error);
  await dest.transfer.applyImport(next);
  expect((await dest.paperProbes.get(paper.id))?.runs).toEqual([]);
  const older = await dest.transfer.previewImport(data);
  if (!older.ok) throw new Error(older.error);
  await dest.transfer.applyImport(older);
  expect((await dest.paperProbes.get(paper.id))?.runs).toEqual([]);
  await repo.papers.delete(paper.id);
  expect(await repo.paperProbes.get(paper.id)).toBeUndefined();
});
