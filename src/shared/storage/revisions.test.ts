import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { webcrypto } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';
import { buildRevision } from '@/core/revision';
import { analyzeText } from '@/core/text';
import type { Issue } from '@/core/schemas';
import { createDb } from './db';
import { createRepositories } from './repositories';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));
const constraints = {
  preserveClaims: true,
  preserveHedging: true,
  noNewFacts: true,
  preserveTerms: [],
} as const;

it('AC-08 AC-12 applies a revision to a new analysis and audits without changing the source', async () => {
  const db = createDb(`revision-${crypto.randomUUID()}`);
  const repo = createRepositories(db);
  const issue: Issue = {
    id: 'i',
    type: 'WEAK_MODIFIER',
    category: 'word',
    findingKind: 'review_candidate',
    status: 'confirmed_by_human',
    severity: 'minor',
    spans: [{ start: 3, end: 7, role: 'word' }],
    sentenceIds: ['s1'],
    metric: { name: 'x', value: 1, unit: null },
    why: 'why',
    suggestedFix: null,
    sourcePrinciple: 'Ch. 16',
    confidence: 1,
  };
  const source = await repo.analyses.create({
    text: await analyzeText('A  very large result.'),
    title: 'Gốc',
    issues: [issue],
  });
  const revision = await buildRevision(
    source,
    {
      revisedText: 'A  quite large result.',
      changes: [
        { issueIds: ['i', 'unknown'], before: 'very', after: 'quite', rationale: 'Rõ hơn' },
        { issueIds: ['other'], before: 'absent', after: 'missing', rationale: 'Không khớp' },
      ],
      needsEvidence: [],
    },
    [issue],
    { ...constraints, preserveTerms: [] },
    { id: crypto.randomUUID(), model: 'fake', createdAt: new Date().toISOString() },
  );
  expect(revision.appliedIssueIds).toEqual(['i']);
  expect(revision.unmatchedChanges).toHaveLength(1);
  await repo.revisions.create(revision);
  expect(await repo.revisions.get(revision.id)).toEqual(revision);
  expect(await repo.revisions.listBySource(source.id)).toEqual([revision]);
  const applied = await repo.revisions.applyRevision(source.id, revision.id);
  expect(applied).toMatchObject({
    parentAnalysisId: source.id,
    origin: { kind: 'revision', revisionId: revision.id },
    title: 'Bản sửa của Gốc',
    text: { sourceText: revision.revisedText },
  });
  expect(await repo.analyses.get(source.id)).toEqual(source);
  expect((await repo.audit.listByAnalysis(source.id)).items.map((event) => event.action)).toEqual([
    'create_analysis',
    'create_revision',
    'apply_revision',
  ]);
  await expect(repo.revisions.applyRevision(crypto.randomUUID(), revision.id)).rejects.toThrow(
    'Revision source mismatch',
  );
  await expect(
    repo.revisions.create({ ...revision, id: crypto.randomUUID(), revisedText: 'tampered' }),
  ).rejects.toThrow('Revision hash mismatch');
  await db.delete();
});

it('AC-12 migrates a version 1 database without changing existing data', async () => {
  const name = `migration-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old
    .version(1)
    .stores({ analyses: 'id, createdAt, updatedAt, text.sourceHash', auditEvents: 'id, analysisId, at' });
  const original = {
    id: crypto.randomUUID(),
    createdAt: 'old',
    updatedAt: 'old',
    text: { sourceHash: 'hash' },
  };
  await old.table('analyses').add(original);
  old.close();
  const db = createDb(name);
  expect(await db.analyses.get(original.id)).toEqual(original);
  expect(await db.revisions.count()).toBe(0);
  await db.delete();
});

it('R1 exports and imports revisions and audit events, while accepting legacy exports', async () => {
  const src = createRepositories(createDb(`export-${crypto.randomUUID()}`));
  const source = await src.analyses.create({ text: await analyzeText('A result.') });
  const revision = await buildRevision(
    source,
    { revisedText: 'The result.', changes: [], needsEvidence: [] },
    [],
    { ...constraints, preserveTerms: [] },
    { id: crypto.randomUUID(), model: 'fake', createdAt: new Date().toISOString() },
  );
  await src.revisions.create(revision);
  await src.revisions.applyRevision(source.id, revision.id);
  const exported = await src.transfer.exportAll('1');
  expect(exported.revisions).toEqual([revision]);
  const dst = createRepositories(createDb(`import-${crypto.randomUUID()}`));
  const plan = await dst.transfer.previewImport(exported);
  if (!plan.ok) throw new Error(plan.error);
  expect(plan.revisionsToInsert).toEqual([revision]);
  await dst.transfer.applyImport(plan);
  expect(await dst.revisions.get(revision.id)).toEqual(revision);
  expect((await dst.audit.listByAnalysis(source.id)).items.map((event) => event.action)).toEqual(
    expect.arrayContaining(['create_revision', 'apply_revision']),
  );
  const legacy: Record<string, unknown> = { ...exported };
  delete legacy.revisions;
  const oldDest = createRepositories(createDb(`legacy-${crypto.randomUUID()}`));
  const oldPlan = await oldDest.transfer.previewImport(legacy);
  expect(oldPlan.ok && oldPlan.revisionsToInsert).toEqual([]);
  if (oldPlan.ok) await oldDest.transfer.applyImport(oldPlan);
  expect(await oldDest.analyses.get(source.id)).toEqual(source);
});
