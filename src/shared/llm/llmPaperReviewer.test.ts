import { beforeEach, expect, it, vi } from 'vitest';
import { BatchBudgetExceededError } from '@/core/batch/runBatch';
import type { Paper } from '@/core/schemas';
import { createLlmClient } from './client';
import { acceptConsent, revokeConsent } from './consent';
import { ConsentRequiredError, InvalidModelOutputError } from './errors';
import { llmPaperReviewer } from './llmPaperReviewer';

const config = { baseUrl: '/llm', model: 'test' };
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
  sections: [{ id: 's', heading: 'Methods', role: 'methods', level: 1, pageStart: null }],
  paragraphs: [
    {
      id: 'p',
      sectionId: 's',
      order: 0,
      text: 'The method is described here for readers.',
      kind: 'body',
      pageStart: null,
      textHash: '',
    },
  ],
};
const output = (lens: string) =>
  JSON.stringify({ lens, summary: 'Tóm tắt', points: [], unanchored: [], cannotJudge: [] });
const response = (content: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
function setup(responses: Response[]) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => responses.shift() ?? response('{}'));
  return { fetch, client: createLlmClient(config, { fetch, sleep: async () => {}, now: () => 0 }) };
}
const options = () => ({
  lenses: ['methods_skeptic', 'clarity_editor'] as const,
  sectionIds: ['s'],
  checkSummary: '',
  config,
  budget: 5,
  onRequest: vi.fn(async (_n: number) => {}),
});
beforeEach(() => localStorage.clear());

it('P5 calls each lens sequentially with temperature and accounts for attempts', async () => {
  acceptConsent(config, true);
  const { client, fetch } = setup([response(output('methods_skeptic')), response(output('clarity_editor'))]);
  const opts = options();
  const result = await llmPaperReviewer(client, paper, { ...opts, lenses: [...opts.lenses] });
  expect(result.map((r) => r.review.lens)).toEqual(opts.lenses);
  expect(opts.onRequest.mock.calls).toEqual([[1], [2]]);
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [, request] of fetch.mock.calls) expect(JSON.parse(String(request?.body)).temperature).toBe(0.3);
});
it('P5 counts retry and repair attempts and stops before exceeding budget', async () => {
  acceptConsent(config, true);
  const { client, fetch } = setup([response('', 429), response('{}'), response(output('methods_skeptic'))]);
  const opts = options();
  await expect(
    llmPaperReviewer(client, paper, { ...opts, lenses: ['methods_skeptic'], budget: 2 }),
  ).rejects.toBeInstanceOf(BatchBudgetExceededError);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(opts.onRequest.mock.calls).toEqual([[1], [2]]);
});
it('P5 validates output, rejects a wrong lens, and propagates repair failure', async () => {
  acceptConsent(config, true);
  const wrong = setup([response(output('clarity_editor'))]);
  await expect(
    llmPaperReviewer(wrong.client, paper, { ...options(), lenses: ['methods_skeptic'] }),
  ).rejects.toThrow('lens');
  const invalid = setup([response('{}'), response('{}')]);
  await expect(
    llmPaperReviewer(invalid.client, paper, { ...options(), lenses: ['methods_skeptic'] }),
  ).rejects.toBeInstanceOf(InvalidModelOutputError);
  expect(invalid.fetch).toHaveBeenCalledTimes(2);
});
it('P5 counts successful repair and checks consent again before the next attempt', async () => {
  acceptConsent(config, true);
  const repaired = setup([response('{}'), response(output('methods_skeptic'))]);
  const opts = options();
  await llmPaperReviewer(repaired.client, paper, { ...opts, lenses: ['methods_skeptic'] });
  expect(opts.onRequest.mock.calls).toEqual([[1], [2]]);
  expect(repaired.fetch).toHaveBeenCalledTimes(2);
  const revoked = setup([response('{}'), response(output('methods_skeptic'))]);
  await expect(
    llmPaperReviewer(revoked.client, paper, {
      ...options(),
      lenses: ['methods_skeptic'],
      onRequest: async () => revokeConsent(),
    }),
  ).rejects.toBeInstanceOf(ConsentRequiredError);
  expect(revoked.fetch).toHaveBeenCalledTimes(1);
});
it('P5 requires whole manuscript consent and checks size before any request', async () => {
  const { client, fetch } = setup([]);
  acceptConsent(config);
  await expect(
    llmPaperReviewer(client, paper, { ...options(), lenses: ['methods_skeptic'] }),
  ).rejects.toBeInstanceOf(ConsentRequiredError);
  acceptConsent(config, true);
  const paragraph = paper.paragraphs[0];
  if (!paragraph) throw new Error('missing fixture');
  await expect(
    llmPaperReviewer(
      client,
      { ...paper, paragraphs: [{ ...paragraph, text: 'x'.repeat(60001) }] },
      { ...options(), lenses: ['methods_skeptic'] },
    ),
  ).rejects.toThrow('60.000');
  expect(fetch).not.toHaveBeenCalled();
  await expect(llmPaperReviewer(client, paper, { ...options(), lenses: [], budget: -1 })).rejects.toThrow(
    'budget',
  );
});
