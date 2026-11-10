import { expect, it, vi } from 'vitest';
import type { Paper } from '@/core/schemas';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { llmSnapshot } from './llmSnapshot';

vi.mock('./consent', async (original) => ({
  ...(await original<typeof import('./consent')>()),
  requirePaperConsent: vi.fn(),
}));

const at = '2026-01-01T00:00:00.000Z';
const paper = (paragraphs: Paper['paragraphs']): Paper => ({
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: 'T',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'text', fileName: 'a', pageCount: 1, sha256: 'x' },
  sections: [{ id: 'a', heading: 'Abstract', role: 'abstract', level: 1, pageStart: 1 }],
  paragraphs,
});
const completeJson = vi.fn(async (request: Parameters<LlmClient['completeJson']>[0]) => {
  await request.onRequest?.();
  return {
    data: request.schema.parse({
      fields: [{ field: 'methods', value: 'Survey', paragraphId: 'p', quote: 'An online survey' }],
    }),
    meta: { model: 'real', promptVersion: request.promptVersion, latencyMs: 1, repaired: false },
  };
}) as unknown as LlmClient['completeJson'];

it('builds a verified snapshot from one request', async () => {
  const run = await llmSnapshot(
    { completeJson },
    paper([
      {
        id: 'p',
        sectionId: 'a',
        order: 0,
        text: 'An online survey of nurses.',
        kind: 'body',
        textHash: 'p',
        pageStart: 1,
      },
    ]),
    {
      config: { model: 'm' } as LlmConfig,
      newId: () => '00000000-0000-4000-8000-000000000002',
      now: () => at,
    },
  );
  expect(run).toMatchObject({ model: 'real', callsUsed: 1, promptVersion: 'snapshot-1', sectionIds: ['a'] });
  expect(run.values.find((value) => value.field === 'methods')?.status).toBe('reported');
});
it('refuses a paper with no readable text', async () => {
  await expect(
    llmSnapshot({ completeJson }, paper([]), { config: { model: 'm' } as LlmConfig }),
  ).rejects.toThrow();
});
