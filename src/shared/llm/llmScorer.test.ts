import { webcrypto } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';
import { AnalysisSchema, SentenceAnnotationSchema } from '@/core/schemas';
import { analyzeText } from '@/core/text';
import { detectCandidates } from '@/core/detectors';
import { assessability } from '@/core/scoring/availability';
import { buildEvidencePackages } from '@/core/scoring/evidencePackage';
import type { LlmClient } from './client';
import { createLlmScorer } from './llmScorer';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));
it('EV-09 packages human decisions and calls scoring provider once with versions', async () => {
  const text = await analyzeText('This is very important. Results were obtained.');
  const detected = detectCandidates(text, null);
  const original = detected[0];
  expect(original).toBeDefined();
  if (!original) return;
  const issues = [
    original,
    { ...original, id: 'dismissed', status: 'dismissed_by_human' as const },
    { ...original, id: 'confirmed', status: 'confirmed_by_human' as const },
    { ...original, id: 'acceptable', severity: 'info' as const },
  ];
  const analysis = AnalysisSchema.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    text,
    context: { before: null, after: null, audience: null },
    contextLimited: true,
    versions: { rubric: null, prompt: null, model: null, syntaxProvider: null },
    sentenceAnnotations: [],
    issues,
    parentAnalysisId: null,
  });
  const availability = assessability(analysis);
  expect(availability.sentence_structure.applicable).toBe(false);
  expect(availability.flow_coherence.applicable).toBe(false);
  const packages = buildEvidencePackages(analysis, availability);
  const allIssues = packages.flatMap((item) => item.issues);
  expect(allIssues.some((item) => item.id === 'dismissed')).toBe(false);
  expect(allIssues.find((item) => item.id === 'confirmed')?.confirmedByHuman).toBe(true);
  expect(allIssues.find((item) => item.id === 'acceptable')?.acceptable).toBe(true);
  const completeJson = vi.fn(async (options) => ({
    data: options.schema.parse({
      dimensions: [
        {
          id: 'verb_word_choice',
          rubric: 3,
          confidence: 0.8,
          evidenceIssueIds: [],
          evidenceSentenceIds: ['s1'],
          rationale: 'Rõ',
        },
      ],
    }),
    meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
  })) as LlmClient['completeJson'];
  const result = await createLlmScorer({ completeJson }).score(analysis);
  expect(completeJson).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({
    model: 'fake',
    promptVersion: 'score-2',
    scores: { rubricVersion: 'schimel-paragraph-v1' },
  });
  const annotated = {
    ...analysis,
    sentenceAnnotations: text.sentences.map((sentence) =>
      SentenceAnnotationSchema.parse({
        sentenceId: sentence.id,
        topicSpan: null,
        actionSpan: null,
        stressSpan: null,
        role: null,
        subjectVerbDistanceTokens: null,
        parseConfidence: null,
      }),
    ),
  };
  expect(assessability(annotated).sentence_structure.applicable).toBe(true);
});
