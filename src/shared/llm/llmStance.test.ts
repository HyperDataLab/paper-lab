import { beforeEach, expect, it, vi } from 'vitest';
import { BatchBudgetExceededError } from '@/core/batch/runBatch';
import type { Paper, StancePending } from '@/core/schemas';
import { createLlmClient } from './client';
import { acceptConsent, revokeConsent } from './consent';
import { ConsentRequiredError } from './errors';
import { llmStance } from './llmStance';

const config = { baseUrl: '/llm', model: 'test' };
const body = (id: string, sectionId: string, text: string) => ({
  id,
  sectionId,
  order: 0,
  text,
  kind: 'body' as const,
  pageStart: 1,
  textHash: '',
});
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: 'T',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
  sections: [{ id: 's', heading: 'Results', role: 'results', level: 1, pageStart: 1 }],
  paragraphs: [
    body('p1', 's', `This may help. ${'x'.repeat(6990)}`),
    body('p2', 's', `That may fail. ${'y'.repeat(100)}`),
  ],
};
const good = JSON.stringify({
  annotations: [
    { paragraphId: 'p1', quote: 'This may help', marker: 'may', category: 'hedges', rationale: 'r' },
  ],
});
const reply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
function setup(contents: string[]) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => reply(contents.shift() ?? good));
  return { fetch, client: createLlmClient(config, { fetch, sleep: async () => {}, now: () => 0 }) };
}
const options = (over = {}) => ({
  sectionIds: ['s'],
  config,
  budget: 10,
  onRequest: vi.fn(),
  onProgress: vi.fn(async () => {}),
  newId: () => '00000000-0000-4000-8000-0000000000aa',
  now: () => '2026-01-02T00:00:00.000Z',
  ...over,
});
beforeEach(() => {
  localStorage.clear();
  acceptConsent(config, true);
});

it('F4 analyses each chunk and builds a verified run', async () => {
  const { client, fetch } = setup([good, good]);
  const result = await llmStance(client, paper, options());
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.run.annotations).toHaveLength(1);
  expect(result.run.callsUsed).toBe(2);
  expect(result.run.failedSectionIds).toEqual([]);
  expect(result.incomplete).toBe(false);
});

it('F4 needs consent before any call', async () => {
  revokeConsent();
  const { client, fetch } = setup([]);
  await expect(llmStance(client, paper, options())).rejects.toBeInstanceOf(ConsentRequiredError);
  expect(fetch).not.toHaveBeenCalled();
});

it('F4 rejects a selection with no prose', async () => {
  const { client } = setup([]);
  await expect(llmStance(client, paper, options({ sectionIds: [] }))).rejects.toThrow('Không có đoạn');
});

it('F4 saves the count before each request, stops at the budget and resumes without repeating', async () => {
  const first = setup([good]);
  let saved: StancePending | null = null;
  const onProgress = vi.fn(async (state: StancePending) => {
    saved = structuredClone(state);
  });
  await expect(llmStance(first.client, paper, options({ budget: 1, onProgress }))).rejects.toBeInstanceOf(
    BatchBudgetExceededError,
  );
  expect(saved).toMatchObject({ callsUsed: 1 });
  expect(Object.keys(saved!.chunks)).toEqual(['chunk-1']);
  const second = setup([good]);
  const result = await llmStance(second.client, paper, options({ pending: saved }));
  expect(second.fetch).toHaveBeenCalledTimes(1);
  expect(result.run.callsUsed).toBe(2);
});

it('F4 retries a failed chunk once and recovers', async () => {
  const { client } = setup(['bad', 'bad', good, good]);
  const result = await llmStance(client, paper, options());
  expect(result.incomplete).toBe(false);
  expect(result.run.failedSectionIds).toEqual([]);
});

it('F4 reports a chunk that still fails and leaves it out of the word count', async () => {
  const { client } = setup(['bad', 'bad', good, 'bad', 'bad']);
  const result = await llmStance(client, paper, options());
  expect(result.incomplete).toBe(true);
  expect(result.run.failedSectionIds).toEqual(['s']);
  expect(result.run.words.s).toBeLessThan(10);
});
