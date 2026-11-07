import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { analyzeText } from '../text';
import { AnalysisSchema, SentenceAnnotationSchema } from '../schemas';
import { assessability } from './availability';
import { buildEvidencePackages } from './evidencePackage';

it('EV-09 supplies structure, roles, measured links and missing model output', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const text = await analyzeText('Cells grow. Roots spread. Leaves emerge.');
  const annotations = text.sentences.map((sentence) =>
    SentenceAnnotationSchema.parse({
      sentenceId: sentence.id,
      topicSpan: null,
      actionSpan: null,
      stressSpan: null,
      role: 'development',
      roleRationale: `role ${sentence.id}`,
      subjectVerbDistanceTokens: null,
      parseConfidence: null,
    }),
  );
  const analysis = AnalysisSchema.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    text,
    context: { before: null, after: null, audience: null },
    contextLimited: true,
    versions: { rubric: null, prompt: null, model: null, syntaxProvider: null },
    sentenceAnnotations: annotations,
    paragraph: {
      type: 'LD',
      confidence: 0.8,
      typeScores: { 'TS-D': 0.1, LD: 0.8, LDR: 0.2, OCAR: 0.1, UNKNOWN: 0.1 },
      centralPoint: { sentenceId: 's1', span: { start: 0, end: 11 }, identifiability: 3, evidence: 'clear' },
      unity: { offTopicSentenceIds: [], rationale: '' },
      rationale: '',
    },
    flowLinks: [
      {
        fromSentenceId: 's1',
        toSentenceId: 's2',
        continuity: 'derived',
        discourseRelation: 'cause',
        linked: true,
        measured: true,
        confidence: 0.9,
        fromSpan: { start: 6, end: 10 },
        toSpan: { start: 12, end: 17 },
        rationale: 'link',
      },
      {
        fromSentenceId: 's2',
        toSentenceId: 's3',
        continuity: 'shift',
        discourseRelation: 'none',
        linked: false,
        measured: false,
        confidence: 0,
        fromSpan: null,
        toSpan: null,
        rationale: 'no model output',
      },
    ],
    issues: [],
    parentAnalysisId: null,
  });
  const packages = buildEvidencePackages(analysis, assessability(analysis));
  expect(packages.find((item) => item.id === 'paragraph_organization')).toMatchObject({
    structure: {
      type: 'LD',
      score: 0.8,
      centralPoint: { sentenceId: 's1', quote: 'Cells grow.', identifiability: 3, evidence: 'clear' },
      roles: [
        { sentenceId: 's1', role: 'development', rationale: 'role s1' },
        { sentenceId: 's2', role: 'development', rationale: 'role s2' },
        { sentenceId: 's3', role: 'development', rationale: 'role s3' },
      ],
    },
  });
  expect(packages.find((item) => item.id === 'flow_coherence')).toMatchObject({
    links: [
      {
        fromSentenceId: 's1',
        toSentenceId: 's2',
        continuity: 'derived',
        relation: 'cause',
        linked: true,
        confidence: 0.9,
        stress: 'grow',
        topic: 'Roots',
        rationale: 'link',
      },
      { fromSentenceId: 's2', toSentenceId: 's3', result: 'no model output' },
    ],
  });
});
