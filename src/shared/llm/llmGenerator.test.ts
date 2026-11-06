import { expect, it, vi } from 'vitest';
import type { LlmClient } from './client';
import { createLlmGenerator } from './llmGenerator';
it('WR-01 provider makes one call and returns versions', async () => {
  const completeJson = vi.fn(async (options) => ({
    data: options.schema.parse({
      paragraph: 'Growth improved.',
      sentences: [{ text: 'Growth improved.', role: 'topic_sentence', evidenceIds: ['e1'], usesClaim: true }],
      needsEvidence: [],
    }),
    meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
  })) as LlmClient['completeJson'];
  const result = await createLlmGenerator({ completeJson }).generate({
    mainClaim: 'Growth improved',
    evidence: [{ id: 'e1', text: 'Growth improved', citation: null }],
    audience: 'general',
    structure: 'auto',
    preserveTerms: [],
    hedging: 'cautious',
  });
  expect(completeJson).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ model: 'fake', promptVersion: 'gen-2' });
});
