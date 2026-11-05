/// <reference types="node" />
import { webcrypto } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';
import { detectCandidates } from '@/core/detectors';
import { analyzeText } from '@/core/text';
import type { LlmClient } from './client';
import { createLlmCandidateJudge } from './llmCandidateJudge';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));
it('batches at 40, returns versions, and skips calls without candidates or passive', async () => {
  const completeJson = vi.fn(async (options: Parameters<LlmClient['completeJson']>[0]) => ({
    data: options.schema.parse({ judgements: [], passive: [] }),
    meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
  })) as LlmClient['completeJson'];
  const judge = createLlmCandidateJudge({ completeJson });
  const context = { before: null, after: null, audience: null };
  const text = await analyzeText(Array.from({ length: 41 }, () => 'Very clear.').join(' '));
  const candidates = detectCandidates(text, null);
  expect(candidates).toHaveLength(41);
  const result = await judge.judge(text, null, candidates, context);
  expect(completeJson).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({ model: 'fake', promptVersion: 'cand-judge-1', issues: candidates });
  await judge.judge(text, null, [], context);
  expect(completeJson).toHaveBeenCalledTimes(2);
});
