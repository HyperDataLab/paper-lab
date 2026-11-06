import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { AnalysisSchema } from '@/core/schemas';
import { analyzeText } from '@/core/text';
import type { LlmClient } from './client';
import { createLlmRevisionProvider } from './llmRevisionProvider';

it('WR-06 WR-08 validates revision output, sends preservation rules, and returns versions in one call', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const text = await analyzeText('The result may improve.');
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
    issues: [],
    parentAnalysisId: null,
  });
  const completeJson = vi.fn(async (options) => {
    expect(options.system).toContain('negation');
    expect(options.system).toContain('needsEvidence');
    expect(options.system).toContain('never invent');
    expect(options.schema.safeParse({ revisedText: 5 }).success).toBe(false);
    return {
      data: options.schema.parse({ revisedText: text.sourceText, changes: [], needsEvidence: [] }),
      meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
    };
  }) as LlmClient['completeJson'];
  const result = await createLlmRevisionProvider({ completeJson }).revise(analysis, [], {
    preserveClaims: true,
    preserveHedging: true,
    noNewFacts: true,
    preserveTerms: [],
  });
  expect(completeJson).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({
    model: 'fake',
    promptVersion: 'revise-1',
    output: { revisedText: text.sourceText },
  });
});
