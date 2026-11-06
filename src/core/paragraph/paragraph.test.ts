import { webcrypto } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';
import { analyzeText } from '../text';
import { ParagraphStructureOutputSchema } from '../prompts/paragraphStructure';
import { validateParagraphStructure } from './validateParagraphStructure';
import { computeParagraphMetrics } from './metrics';
import { paragraphIssues } from './issues';
import { SentenceAnnotationSchema } from '../schemas/analysis';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));

it('EV-07 EV-08 retains adjacent pairs, supplies missing roles and reports fractions', async () => {
  const text = await analyzeText('First sentence. Second sentence. Third sentence.');
  const raw = ParagraphStructureOutputSchema.parse({
    type: 'LD',
    typeScores: { 'TS-D': 0.1, LD: 0.2, LDR: 0.1, OCAR: 0.1, UNKNOWN: 0.1 },
    centralPointSentenceId: 's9',
    identifiability: 2,
    evidence: '',
    roles: [],
    offTopicSentenceIds: ['s9'],
    unityRationale: '',
    pairs: [
      {
        fromSentenceId: 's1',
        toSentenceId: 's3',
        continuity: 'derived',
        discourseRelation: 'example',
        linked: true,
        confidence: 1,
        rationale: '',
      },
    ],
    rationale: '',
  });
  const result = validateParagraphStructure(raw, text, []);
  expect(result.paragraph.type).toBe('UNKNOWN');
  expect(result.paragraph.centralPoint.sentenceId).toBeNull();
  expect(result.roles.map((role) => role.role)).toEqual(['unknown', 'unknown', 'unknown']);
  expect(result.flowLinks).toHaveLength(2);
  expect(result.flowLinks[0]).toMatchObject({
    continuity: 'shift',
    discourseRelation: 'none',
    confidence: 0,
    fromSpan: null,
    toSpan: null,
  });
  expect(
    computeParagraphMetrics(result.paragraph, result.roles, result.flowLinks).stress_to_next_topic_alignment
      .value,
  ).toBeNull();
  // Pairs without model output (confidence 0, "no model output") carry no evidence: no findings.
  expect(result.flowLinks.every((link) => link.rationale === 'no model output')).toBe(true);
  expect(paragraphIssues(result.paragraph, result.flowLinks, text)).toEqual([]);
});

it('EV-07 old free-string roles become null', () => {
  const annotation = SentenceAnnotationSchema.parse({
    sentenceId: 's1',
    topicSpan: null,
    actionSpan: null,
    stressSpan: null,
    role: 'legacy role',
    subjectVerbDistanceTokens: null,
    parseConfidence: null,
  });
  expect(annotation.role).toBeNull();
  expect(annotation.roleConfidence).toBeNull();
});

it('AC-09 motivated shifts and unknown structure do not create findings', async () => {
  const text = await analyzeText('First sentence. Second sentence.');
  const raw = ParagraphStructureOutputSchema.parse({
    type: 'UNKNOWN',
    typeScores: { 'TS-D': 0.1, LD: 0.1, LDR: 0.1, OCAR: 0.1, UNKNOWN: 0.8 },
    centralPointSentenceId: null,
    identifiability: 3,
    evidence: '',
    roles: [],
    offTopicSentenceIds: [],
    unityRationale: '',
    pairs: [
      {
        fromSentenceId: 's1',
        toSentenceId: 's2',
        continuity: 'shift',
        discourseRelation: 'example',
        linked: false,
        confidence: 0.9,
        rationale: '',
      },
    ],
    rationale: '',
  });
  const result = validateParagraphStructure(raw, text, []);
  expect(paragraphIssues(result.paragraph, result.flowLinks, text)).toEqual([]);
  if (raw.pairs[0]) raw.pairs[0].discourseRelation = 'sequence';
  expect(
    paragraphIssues(result.paragraph, validateParagraphStructure(raw, text, []).flowLinks, text),
  ).toEqual([]);
});
