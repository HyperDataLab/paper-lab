import { webcrypto } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';
import { analyzeText, sliceCp } from '@/core/text';
import { SentenceAnnotationSchema } from '@/core/schemas';
import type { LlmClient } from './client';
import { createLlmParagraphAnalyzer, MissingSentenceAnnotationsError } from './llmParagraphAnalyzer';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));
it('AC-05 EV-08 makes one call and anchors both flow endpoints to annotations', async () => {
  const source =
    'The performance improved. These improvements are very significant. Several experiments were conducted.';
  const text = await analyzeText(source);
  const stressStart = source.indexOf('improvements');
  const stressEnd = source.indexOf(' significant') + ' significant'.length;
  const topicStart = source.indexOf('Several');
  const topicEnd = topicStart + 'Several experiments'.length;
  const annotations = text.sentences.map((sentence) =>
    SentenceAnnotationSchema.parse({
      sentenceId: sentence.id,
      topicSpan: sentence.id === 's3' ? { start: topicStart, end: topicEnd } : null,
      actionSpan: null,
      stressSpan: sentence.id === 's2' ? { start: stressStart, end: stressEnd } : null,
      role: null,
      subjectVerbDistanceTokens: null,
      parseConfidence: null,
    }),
  );
  const answer = {
    type: 'LD',
    typeScores: { 'TS-D': 0.1, LD: 0.8, LDR: 0.2, OCAR: 0.1, UNKNOWN: 0.1 },
    centralPointSentenceId: 's1',
    identifiability: 3,
    evidence: 'Rõ',
    roles: [],
    offTopicSentenceIds: [],
    unityRationale: '',
    pairs: [
      {
        fromSentenceId: 's1',
        toSentenceId: 's2',
        continuity: 'derived',
        discourseRelation: 'example',
        linked: true,
        confidence: 0.9,
        rationale: '',
      },
      {
        fromSentenceId: 's2',
        toSentenceId: 's3',
        continuity: 'shift',
        discourseRelation: 'none',
        linked: false,
        confidence: 0.9,
        rationale: '',
      },
    ],
    rationale: '',
  };
  const completeJson = vi.fn(async (options) => ({
    data: options.schema.parse(answer),
    meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
  })) as LlmClient['completeJson'];
  const provider = createLlmParagraphAnalyzer({ completeJson });
  const context = { before: null, after: null, audience: null } as const;
  await expect(provider.analyze(text, null, context)).rejects.toBeInstanceOf(MissingSentenceAnnotationsError);
  const result = await provider.analyze(text, annotations, context);
  expect(completeJson).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ model: 'fake', promptVersion: 'para-struct-2' });
  expect(result.issues).toHaveLength(1);
  const issue = result.issues[0];
  expect(issue?.id).toBe(`FLOW_BREAK_CANDIDATE:s2-s3:${stressStart}-${topicEnd}`);
  expect(issue?.spans.map((span) => sliceCp(source, span.start, span.end))).toEqual([
    'improvements are very significant',
    'Several experiments',
  ]);
});
