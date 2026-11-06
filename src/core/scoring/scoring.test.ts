import { expect, it } from 'vitest';
import { DIMENSIONS } from './rubric';
import { computeScores, issueSnapshot } from './computeScores';
import type { Availability } from './availability';
import { buildScoringPrompt } from '../prompts/scoring';
import type { Issue } from '../schemas/issue';
import { webcrypto } from 'node:crypto';
import { vi } from 'vitest';
import { analyzeText } from '../text';

const available = Object.fromEntries(
  DIMENSIONS.map((item) => [item.id, { applicable: true, reason: null }]),
) as Availability;
const raw = {
  dimensions: DIMENSIONS.map((item, index) => ({
    id: item.id,
    rubric: (index === 0 ? 4 : 2) as 2 | 4,
    confidence: index === 0 ? 1 : 0.5,
    evidenceIssueIds: ['good', 'dismissed', 'unknown'],
    evidenceSentenceIds: ['s1', 'unknown'],
    rationale: 'Rõ',
  })),
};
const issue = (id: string, status: Issue['status']) => ({ id, status, severity: 'minor' }) as Issue;
const issues = [issue('good', 'candidate'), issue('dismissed', 'dismissed_by_human')];
const meta = { sentenceIds: ['s1'], contextLimited: true };
it('AC-10 EV-09 renormalises weights and suppresses totals at two missing dimensions', () => {
  const one = { ...available, flow_coherence: { applicable: false, reason: 'thiếu' } };
  const result = computeScores(raw, one, issues, meta);
  expect(result.overall).toBe(65.6);
  expect(result.coverage).toEqual({ applicable: 4, total: 5, value: 0.8 });
  expect(result.dimensions[0]).toMatchObject({
    score: 100,
    evidence: { issueIds: ['good'], sentenceIds: ['s1'] },
  });
  expect(result.confidence).toBeCloseTo(0.65625);
  expect(result.dimensions[4]).toMatchObject({
    applicable: false,
    rubric: null,
    notAssessableReason: 'thiếu',
  });
  const two = computeScores(
    raw,
    { ...one, paragraph_organization: { applicable: false, reason: 'thiếu' } },
    issues,
    meta,
  );
  expect(two.overall).toBeNull();
  expect(two.overallSuppressedReason).toContain('2 tiêu chí');
});
it('EV-09 handles insufficient model evidence and stale decisions', () => {
  const result = computeScores(
    { dimensions: raw.dimensions.map((item) => ({ ...item, rubric: null })) },
    available,
    issues,
    meta,
  );
  expect(result.dimensions[0]?.notAssessableReason).toBe('AI không đủ căn cứ');
  expect(result.confidence).toBeNull();
  expect(issueSnapshot(issues)).not.toBe(
    issueSnapshot([issue('good', 'confirmed_by_human'), issues[1] as Issue]),
  );
});
it('AC-09 prompt lists segmented sentence ids and rejects deductions from counts and passive voice alone', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const text = await analyzeText('Cells grow. Roots spread.');
  const prompt = buildScoringPrompt(text, [], [], {});
  const input = JSON.parse(prompt.user) as { sentences: string };
  expect(input.sentences).toBe('s1 | "Cells grow."\ns2 | "Roots spread."');
  expect(prompt.system).toContain('Counts are not deductions');
  expect(prompt.system).toContain('Passive voice, hedges and necessary qualifiers are not faults');
});
