import { expect, it, vi } from 'vitest';
import { BatchBudgetExceededError } from '@/core/batch/runBatch';
import type { ArgumentPending, Paper } from '@/core/schemas';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { llmArgument } from './llmArgument';

vi.mock('./consent', async (original) => ({
  ...(await original<typeof import('./consent')>()),
  requirePaperConsent: vi.fn(),
}));

const at = '2026-01-01T00:00:00.000Z';
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: 'T',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'text', fileName: 'a', pageCount: 1, sha256: 'x' },
  sections: [{ id: 's', heading: 'Results', role: 'results', level: 1, pageStart: 1 }],
  paragraphs: [
    {
      id: 'p',
      sectionId: 's',
      order: 0,
      text: 'The claim holds.',
      kind: 'body',
      textHash: 'p',
      pageStart: 1,
    },
  ],
};
const options = (over: Partial<Parameters<typeof llmArgument>[2]> = {}) => ({
  sectionIds: ['s'],
  config: { model: 'm' } as LlmConfig,
  budget: 3,
  onRequest: vi.fn(),
  onProgress: vi.fn(async () => {}),
  newId: () => '00000000-0000-4000-8000-000000000002',
  now: () => at,
  ...over,
});
const fake = (error?: Error) =>
  vi.fn(async (request: Parameters<LlmClient['completeJson']>[0]) => {
    await request.onRequest?.();
    if (error) throw error;
    return {
      data: request.schema.parse({
        arguments: [
          {
            claim: { paragraphId: 'p', quote: 'The claim holds' },
            importance: 'main',
            claimType: 'causal',
            data: [],
            statedWarrant: null,
            inferredWarrant: null,
            backing: [],
            qualifier: null,
            rebuttals: [],
          },
        ],
      }),
      meta: { model: 'real', promptVersion: request.promptVersion, latencyMs: 1, repaired: false },
    };
  }) as unknown as LlmClient['completeJson'];

it('CT builds a run carrying the verified claim type', async () => {
  const { run, incomplete } = await llmArgument({ completeJson: fake() }, paper, options());
  expect(incomplete).toBe(false);
  expect(run).toMatchObject({ model: 'real', promptVersion: 'argument-3', callsUsed: 1 });
  expect(run.arguments[0]?.claim.excerpt).toBe('The claim holds');
  expect(run.arguments[0]?.claimType).toBe('causal');
});
it('D4 reports a failed part and refuses an empty selection', async () => {
  const failed = await llmArgument({ completeJson: fake(new Error('bad')) }, paper, options());
  expect(failed.incomplete).toBe(true);
  expect(failed.run.failedSectionIds).toEqual(['s']);
  await expect(llmArgument({ completeJson: fake() }, paper, options({ sectionIds: [] }))).rejects.toThrow();
});
it('D4 does not repeat finished parts on resume', async () => {
  const completeJson = fake();
  const pending: ArgumentPending = {
    sectionIds: ['s'],
    callsUsed: 1,
    model: 'old',
    chunks: { 'chunk-1': { arguments: [] } },
  };
  await llmArgument({ completeJson }, paper, options({ pending }));
  expect(completeJson).not.toHaveBeenCalled();
});
it('D4 stops at the budget and on cancel', async () => {
  await expect(llmArgument({ completeJson: fake() }, paper, options({ budget: 0 }))).rejects.toBeInstanceOf(
    BatchBudgetExceededError,
  );
  await expect(
    llmArgument({ completeJson: fake(new DOMException('stop', 'AbortError')) }, paper, options()),
  ).rejects.toBeInstanceOf(DOMException);
});
