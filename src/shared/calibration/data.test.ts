import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { analyzeText } from '@/core/text';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { loadCalibration } from './data';

it('P7 uses latest audit decision across analyses and counts repeated imported labels once', async () => {
  vi.stubGlobal('crypto', webcrypto);
  let date = '2026-01-01T00:00:00.000Z';
  const repo = createRepositories(createDb(`dedup-${crypto.randomUUID()}`), () => new Date(date));
  const text = await analyzeText('Very clear.');
  const issue = {
    id: 'i',
    type: 'WEAK_MODIFIER' as const,
    category: 'word' as const,
    findingKind: 'review_candidate' as const,
    status: 'candidate' as const,
    severity: 'minor' as const,
    spans: [{ start: 0, end: 4, role: 'word' }],
    sentenceIds: ['s1'],
    metric: { name: 'x', value: null, unit: null },
    why: '',
    suggestedFix: null,
    sourcePrinciple: '',
    confidence: 1,
  };
  const a = await repo.analyses.create({ text, issues: [issue] });
  const b = await repo.analyses.create({ text, issues: [issue] });
  date = '2026-01-02T00:00:00.000Z';
  await repo.analyses.reviewIssue(b.id, 'i', { status: 'dismissed_by_human' });
  date = '2026-01-03T00:00:00.000Z';
  await repo.analyses.reviewIssue(a.id, 'i', { status: 'confirmed_by_human' });
  const label = {
    rater: 'Alice',
    target: { kind: 'issue', type: 'WEAK_MODIFIER', textHash: text.sourceHash, quote: 'Very' },
    label: 'incorrect',
  };
  const set = { format: 'paragraph-lab-labels', version: 1, labels: [label] };
  await repo.calibrationLabels.import('a.json', set);
  await repo.calibrationLabels.import('a.json', set);
  const result = await loadCalibration(repo);
  expect(result.conflicts).toBe(1);
  expect(result.stats[0]).toMatchObject({ n: 2, correct: 1, incorrect: 1 });
});
