import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { analyzeText } from '@/core/text';
import { validateAnalysisSpans, InvalidAnalysisError, type AnalysisInput, type Issue } from '@/core/schemas';
import { planImport } from '@/core/transfer/planImport';
import { createDb } from './db';
import { createRepositories, SourceImmutableError, type AnalysisPatch } from './repositories';
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
});
async function setup() {
  const db = createDb(`test-${crypto.randomUUID()}`);
  const repo = createRepositories(db);
  const text = await analyzeText('One sentence. Another sentence.');
  const analysis = await repo.analyses.create({ text });
  return { db, repo, analysis };
}
it('AC-04 suppresses an invalid flow endpoint on save', async () => {
  const { repo, analysis } = await setup();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const updated = await repo.analyses.update(analysis.id, {
    flowLinks: [
      {
        fromSentenceId: 's1',
        toSentenceId: 's2',
        continuity: 'shift',
        discourseRelation: 'none',
        linked: false,
        confidence: 0.8,
        fromSpan: { start: 0, end: 999 },
        toSpan: null,
        rationale: '',
      },
    ],
  });
  expect(updated.flowLinks[0]?.fromSpan).toBeNull();
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
it('EV-11 creates and deletes while retaining audit events', async () => {
  const { repo, analysis } = await setup();
  expect((await repo.audit.listByAnalysis(analysis.id)).items.map((e) => e.action)).toEqual([
    'create_analysis',
  ]);
  await repo.analyses.delete(analysis.id);
  expect(await repo.analyses.get(analysis.id)).toBeUndefined();
  expect((await repo.audit.listByAnalysis(analysis.id)).items.map((e) => e.action)).toEqual([
    'create_analysis',
    'delete_analysis',
  ]);
});
it('EV-11 AC-05 AC-06 AC-12 audits review changes without altering source or spans', async () => {
  const { repo, analysis } = await setup();
  const issue: Issue = {
    id: 'review',
    type: 'FUZZY_VERB',
    category: 'word',
    findingKind: 'review_candidate',
    status: 'candidate',
    severity: 'minor',
    spans: [{ start: 0, end: 3, role: 'word' }],
    sentenceIds: ['s1'],
    metric: { name: 'x', value: 1, unit: 'candidate' },
    why: '',
    suggestedFix: null,
    sourcePrinciple: '',
    confidence: 1,
  };
  await repo.analyses.update(analysis.id, { issues: [issue] });
  await repo.analyses.reviewIssue(analysis.id, issue.id, { status: 'confirmed_by_human' });
  await repo.analyses.reviewIssue(analysis.id, issue.id, { severity: 'major' });
  await repo.analyses.reviewIssue(analysis.id, issue.id, { status: 'dismissed_by_human' });
  const result = await repo.analyses.reviewIssue(analysis.id, issue.id, { status: 'candidate' });
  expect(result.text).toEqual(analysis.text);
  expect(result.issues[0]?.spans).toEqual(issue.spans);
  expect((await repo.audit.listByAnalysis(analysis.id)).items.map((e) => e.action)).toEqual([
    'create_analysis',
    'confirm',
    'edit_severity',
    'dismiss',
    'reopen',
  ]);
  await expect(repo.analyses.reviewIssue(analysis.id, 'missing', { severity: 'minor' })).rejects.toThrow(
    'Issue not found',
  );
});
it('AC-12 rejects source changes and leaves the record intact', async () => {
  const { repo, analysis } = await setup();
  await expect(
    repo.analyses.update(analysis.id, { text: analysis.text } as unknown as AnalysisPatch),
  ).rejects.toBeInstanceOf(SourceImmutableError);
  await expect(
    repo.analyses.update(analysis.id, { createdAt: '2000-01-01T00:00:00.000Z' } as unknown as AnalysisPatch),
  ).rejects.toThrow('Invalid analysis patch');
  expect(await repo.analyses.get(analysis.id)).toEqual(analysis);
});
it('EV-12 rejects stale previews and source changes even with the same hash', async () => {
  const { repo, analysis } = await setup();
  const data = await repo.transfer.exportAll('1');
  const incoming = { ...analysis, updatedAt: '2100-01-01T00:00:00.000Z' };
  const plan = await repo.transfer.previewImport({ ...data, analyses: [incoming] });
  if (!plan.ok) throw new Error(plan.error);
  const altered = await analyzeText(`X${incoming.text.sourceText.slice(1)}`);
  await expect(
    repo.transfer.applyImport({
      ...plan,
      toUpdate: [{ ...incoming, text: { ...altered, sourceHash: incoming.text.sourceHash } }],
    }),
  ).rejects.toBeInstanceOf(SourceImmutableError);
  await repo.transfer.applyImport(plan);
  await expect(repo.transfer.applyImport(plan)).rejects.toThrow('Import preview is out of date');
});
it('EV-12 exports and imports analyses and audit events', async () => {
  const { repo, analysis } = await setup();
  const data = await repo.transfer.exportAll('1');
  const dest = createRepositories(createDb(`test-${crypto.randomUUID()}`));
  const plan = await dest.transfer.previewImport(data);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  await dest.transfer.applyImport(plan);
  expect(await dest.analyses.get(analysis.id)).toEqual(analysis);
  expect((await dest.audit.listAll()).items).toEqual(expect.arrayContaining(data.auditEvents));
  expect((await dest.audit.listAll()).items).toHaveLength(data.auditEvents.length + 1);
  expect((await dest.audit.listAll()).items.filter((event) => event.action === 'import')).toHaveLength(1);
  const again = await dest.transfer.previewImport(data);
  expect(again.ok && again.auditEvents).toHaveLength(0);
});
it('EV-12 skips tampered or invalid analyses and their audit while importing valid entries', async () => {
  const { repo, analysis } = await setup();
  const second = await repo.analyses.create({ text: await analyzeText('A valid second paragraph.') });
  const data = await repo.transfer.exportAll('1');
  const dest = createRepositories(createDb(`test-${crypto.randomUUID()}`));
  const tampered = {
    ...analysis,
    text: { ...analysis.text, sourceText: `X${analysis.text.sourceText.slice(1)}` },
  };
  const plan = await dest.transfer.previewImport({ ...data, analyses: [tampered, second] });
  if (!plan.ok) throw new Error(plan.error);
  expect(plan.skipped[0]?.reason).toBe('source hash mismatch');
  expect(plan.auditSkipped).toBe(1);
  await dest.transfer.applyImport(plan);
  expect(await dest.analyses.get(second.id)).toEqual(second);
  expect(await dest.analyses.get(analysis.id)).toBeUndefined();
  expect((await dest.audit.listByAnalysis(analysis.id)).items).toHaveLength(0);
  const first = analysis.text.tokens[0];
  if (!first) throw new Error('missing token');
  const bad = {
    ...analysis,
    text: { ...analysis.text, tokens: [{ ...first, text: 'bad' }, ...analysis.text.tokens.slice(1)] },
  };
  const preview = await dest.transfer.previewImport({ ...data, analyses: [bad, second] });
  if (!preview.ok) throw new Error(preview.error);
  expect(preview.skipped[0]?.reason).toContain('invalid analysis:');
});
it('EV-12 plans conflicts, versions and schema errors', async () => {
  const { repo, analysis } = await setup();
  const data = await repo.transfer.exportAll('1');
  const hashes = new Map([[analysis.id, analysis.text.sourceHash]]);
  expect(planImport({ ...data, format: 'bad' }, new Map(), new Set(), hashes).ok).toBe(false);
  expect(planImport({ ...data, formatVersion: 2 }, new Map(), new Set(), hashes).ok).toBe(false);
  const invalidEnvelope = planImport({ ...data, exportedAt: 'bad' }, new Map(), new Set(), hashes);
  expect(!invalidEnvelope.ok && invalidEnvelope.error).toContain('exportedAt');
  const invalid = planImport(
    { ...data, analyses: [{ ...analysis, id: 'bad' }] },
    new Map(),
    new Set(),
    hashes,
  );
  expect(invalid.ok && invalid.skipped[0]?.reason).toContain('invalid analysis: id');
  const existing = new Map([
    [analysis.id, { updatedAt: '2000-01-01T00:00:00.000Z', sourceHash: analysis.text.sourceHash }],
  ]);
  const newer = planImport(data, existing, new Set(), hashes);
  expect(newer.ok && newer.toUpdate).toHaveLength(1);
  existing.set(analysis.id, { updatedAt: '2100-01-01T00:00:00.000Z', sourceHash: analysis.text.sourceHash });
  const older = planImport(data, existing, new Set(), hashes);
  expect(older.ok && older.skipped[0]?.reason).toBe('not newer');
  existing.set(analysis.id, { updatedAt: analysis.updatedAt, sourceHash: 'other' });
  const different = planImport(data, existing, new Set(), hashes);
  expect(different.ok && different.skipped[0]?.reason).toBe('source text differs');
  expect(different.ok && different.auditSkipped).toBe(data.auditEvents.length);
});
it('AC-04 suppresses ungrounded issues and annotations and rejects invalid token offsets', async () => {
  const { analysis } = await setup();
  const issue: Issue = {
    id: 'i',
    type: 'FUZZY_VERB',
    category: 'word',
    findingKind: 'review_candidate',
    status: 'candidate',
    severity: 'minor',
    spans: [{ start: 0, end: 3, role: 'word' }],
    sentenceIds: ['s1'],
    metric: { name: 'x', value: null, unit: null },
    why: '',
    suggestedFix: null,
    sourcePrinciple: '',
    confidence: 1,
  };
  // S3-era annotation shape (without the S5 fields) must still be accepted.
  const value: AnalysisInput = {
    ...analysis,
    issues: [
      issue,
      { ...issue, id: 'bad', spans: [{ start: 0, end: 999, role: 'word' }] },
      { ...issue, id: 'unknown', sentenceIds: ['s99'] },
    ],
    sentenceAnnotations: [
      {
        sentenceId: 's1',
        topicSpan: { start: 0, end: 999 },
        actionSpan: null,
        stressSpan: null,
        role: null,
        subjectVerbDistanceTokens: null,
        parseConfidence: null,
      },
      {
        sentenceId: 's99',
        topicSpan: null,
        actionSpan: null,
        stressSpan: null,
        role: null,
        subjectVerbDistanceTokens: null,
        parseConfidence: null,
      },
    ],
  };
  const checked = validateAnalysisSpans(value);
  expect(checked.valid.issues).toHaveLength(1);
  expect(checked.suppressed).toHaveLength(4);
  expect(checked.valid.sentenceAnnotations).toHaveLength(1);
  const token = value.text.tokens[0];
  if (!token) throw new Error('missing token');
  expect(() =>
    validateAnalysisSpans({ ...value, text: { ...value.text, tokens: [{ ...token, end: 999 }] } }),
  ).toThrow(InvalidAnalysisError);
  const sentence = value.text.sentences[0];
  if (!sentence) throw new Error('missing sentence');
  expect(() =>
    validateAnalysisSpans({
      ...value,
      text: {
        ...value.text,
        sentences: [{ ...sentence, end: sentence.end - 1 }, ...value.text.sentences.slice(1)],
      },
    }),
  ).toThrow('invalid token range');
});
it('lists newest first and counts corrupt records', async () => {
  const { db, repo, analysis } = await setup();
  await repo.analyses.update(analysis.id, { title: 'updated' });
  await db.analyses.add({ ...analysis, id: crypto.randomUUID(), updatedAt: 'bad' });
  const list = await repo.analyses.list();
  expect(list.corrupt).toBe(1);
  expect(list.items[0]?.title).toBe('updated');
});
