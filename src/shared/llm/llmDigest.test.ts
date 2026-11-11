import { expect, it, vi } from 'vitest';
import type { Paper } from '@/core/schemas';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { llmDigest } from './llmDigest';

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
  sections: [{ id: 'r', heading: 'Results', role: 'results', level: 1, pageStart: 1 }],
  paragraphs,
});
const completeJson = vi.fn(async (request: Parameters<LlmClient['completeJson']>[0]) => {
  await request.onRequest?.();
  return {
    data: request.schema.parse({
      headline: 'Nurses answered a survey.',
      overview: { text: 'An online survey of 120 nurses.', refs: ['p'] },
      sections: [{ heading: 'Results', blocks: [{ text: 'Most agreed.', refs: ['p'], items: [] }] }],
    }),
    meta: { model: 'real', promptVersion: request.promptVersion, latencyMs: 1, repaired: false },
  };
}) as unknown as LlmClient['completeJson'];

it('R12 writes the reader summary in one request and checks it against the paper', async () => {
  const run = await llmDigest(
    { completeJson },
    paper([
      {
        id: 'p',
        sectionId: 'r',
        order: 0,
        text: 'An online survey of 120 nurses. Most agreed.',
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
  expect(run).toMatchObject({ model: 'real', callsUsed: 1, promptVersion: 'digest-1', read: 1, total: 1 });
  expect(run.overview.flags).toEqual([]);
  const request = vi.mocked(completeJson).mock.calls[0]?.[0];
  expect(request?.user).toContain('## Results');
  expect(request?.user).toContain('p | "An online survey of 120 nurses. Most agreed."');
});

it('R12 refuses a paper with no readable text', async () => {
  await expect(
    llmDigest({ completeJson }, paper([]), { config: { model: 'm' } as LlmConfig }),
  ).rejects.toThrow();
});
