import { expect, it, vi } from 'vitest';
import { BatchBudgetExceededError } from '@/core/batch/runBatch';
import type { Paper, RhetoricPending } from '@/core/schemas';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { estimateRhetoric, llmRhetoric } from './llmRhetoric';

vi.mock('./consent', async (original) => ({
  ...(await original<typeof import('./consent')>()),
  requirePaperConsent: vi.fn(),
}));

const at = '2026-01-01T00:00:00.000Z';
const paragraph = (id: string, sectionId: string, text: string) => ({
  id,
  sectionId,
  order: 0,
  text,
  kind: 'body' as const,
  textHash: id,
  pageStart: 1,
});
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: 'T',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'text', fileName: 'a', pageCount: 1, sha256: 'x' },
  sections: [
    { id: 'a', heading: 'Abstract', role: 'abstract', level: 1, pageStart: 1 },
    { id: 'r', heading: 'Results', role: 'results', level: 1, pageStart: 1 },
  ],
  paragraphs: [paragraph('pa', 'a', 'We found an effect.'), paragraph('pr', 'r', 'The effect held.')],
};
const config = { model: 'm' } as LlmConfig;
const options = (over: Partial<Parameters<typeof llmRhetoric>[2]> = {}) => ({
  sectionIds: ['a', 'r'],
  config,
  budget: 5,
  onRequest: vi.fn(),
  onProgress: vi.fn(async () => {}),
  newId: () => '00000000-0000-4000-8000-000000000002',
  now: () => at,
  ...over,
});
function fake(fail?: (schema: string) => Error | undefined) {
  return vi.fn(async (request: Parameters<LlmClient['completeJson']>[0]) => {
    await request.onRequest?.();
    const error = fail?.(request.schemaName);
    if (error) throw error;
    const data =
      request.schemaName === 'rhetoric'
        ? { items: [{ paragraphId: 'pa', quote: 'We found', category: 'occupy', rationale: 'r' }] }
        : {
            claims: [
              {
                abstractParagraphId: 'pa',
                abstractQuote: 'an effect',
                supportParagraphId: 'pr',
                supportQuote: 'effect held',
                rationale: 'r',
              },
            ],
          };
    return {
      data: request.schema.parse(data),
      meta: { model: 'real', promptVersion: request.promptVersion, latencyMs: 1, repaired: false },
    };
  }) as unknown as LlmClient['completeJson'];
}

it('D3 reads each part, compares the abstract once and estimates the same', async () => {
  const completeJson = fake();
  const { run, incomplete } = await llmRhetoric({ completeJson }, paper, options());
  expect(estimateRhetoric(paper, ['a', 'r'])).toBe(2);
  expect(completeJson).toHaveBeenCalledTimes(2);
  expect(incomplete).toBe(false);
  expect(run.items).toHaveLength(1);
  expect(run.abstractClaims[0]?.support?.paragraphId).toBe('pr');
  expect(run).toMatchObject({ model: 'real', callsUsed: 2, promptVersion: 'rhetoric-1+abstract-align-1' });
});
it('D3 skips the comparison without an abstract and refuses an empty selection', async () => {
  expect(estimateRhetoric(paper, ['r'])).toBe(1);
  const completeJson = fake();
  const { run } = await llmRhetoric({ completeJson }, paper, options({ sectionIds: ['r'] }));
  expect(run.abstractChecked).toBe(false);
  await expect(llmRhetoric({ completeJson }, paper, options({ sectionIds: [] }))).rejects.toThrow();
});
it('D3 keeps going past a failed part and reports it incomplete', async () => {
  const completeJson = fake((schema) => (schema === 'rhetoric' ? new Error('bad output') : undefined));
  const { run, incomplete } = await llmRhetoric({ completeJson }, paper, options());
  expect(incomplete).toBe(true);
  expect(run.failedSectionIds).toEqual(['a', 'r']);
  expect(run.abstractChecked).toBe(true);
});
it('D3 resumes without repeating finished parts', async () => {
  const completeJson = fake();
  const pending: RhetoricPending = {
    sectionIds: ['a', 'r'],
    callsUsed: 1,
    model: 'old',
    chunks: { 'chunk-1': { items: [] } },
    alignment: null,
  };
  await llmRhetoric({ completeJson }, paper, options({ pending }));
  expect(completeJson).toHaveBeenCalledTimes(1);
});
it('D3 stops at the budget instead of treating it as a failed part', async () => {
  await expect(llmRhetoric({ completeJson: fake() }, paper, options({ budget: 0 }))).rejects.toBeInstanceOf(
    BatchBudgetExceededError,
  );
});
it('D3 stops when the user cancels', async () => {
  const completeJson = fake(() => new DOMException('stop', 'AbortError'));
  await expect(llmRhetoric({ completeJson }, paper, options())).rejects.toBeInstanceOf(DOMException);
});
