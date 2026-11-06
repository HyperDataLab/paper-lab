import { expect, it } from 'vitest';
import type { Issue } from '@/core/schemas';
import { mergeHumanDecisions } from './useCandidateJudge';

const flow: Issue = {
  id: 'FLOW_BREAK_CANDIDATE:s2-s3:120-176',
  type: 'FLOW_BREAK_CANDIDATE',
  category: 'flow',
  findingKind: 'review_candidate',
  status: 'candidate',
  severity: 'moderate',
  spans: [
    { start: 120, end: 136, role: 'stress_from', sentenceId: 's2' },
    { start: 157, end: 176, role: 'topic_to', sentenceId: 's3' },
  ],
  sentenceIds: ['s2', 's3'],
  metric: { name: 'stress_to_next_topic_alignment', value: 0, unit: 'pair' },
  why: 'new why',
  suggestedFix: null,
  sourcePrinciple: 'Schimel Ch. 13',
  confidence: 0.8,
};

it('EV-11 a paragraph re-run keeps human decisions and severity by id, and drops nothing new', () => {
  const dismissed = {
    ...flow,
    status: 'dismissed_by_human' as const,
    severity: 'minor' as const,
    why: 'old',
  };
  const off: Issue = { ...flow, id: 'OFF_TOPIC_SENTENCE:s3:157-215', type: 'OFF_TOPIC_SENTENCE' };
  const merged = mergeHumanDecisions([flow, off], [dismissed]);
  expect(merged[0]).toMatchObject({ status: 'dismissed_by_human', severity: 'minor', why: 'new why' });
  expect(merged[1]).toEqual(off);
  const confirmed = { ...flow, status: 'confirmed_by_human' as const };
  expect(mergeHumanDecisions([flow], [confirmed])[0]?.status).toBe('confirmed_by_human');
  expect(mergeHumanDecisions([flow], [{ ...flow, status: 'confirmed_by_model' }])[0]?.status).toBe(
    'candidate',
  );
});
