import { expect, it, vi } from 'vitest';
import { planRun, runBatch } from '@/core/batch';
import { mergeTransitions } from '@/core/paperOverview';
import type { Paper, PaperRun, PaperOverviewRecord, TransitionPair } from '@/core/schemas';
import type { LlmClient } from './client';
import { createLlmParagraphTransition } from './llmParagraphTransition';

const at = '2026-01-01T00:00:00.000Z';
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: '',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
  sections: [{ id: 's', heading: '', role: 'methods', level: 1, pageStart: null }],
  paragraphs: Array.from({ length: 14 }, (_, i) => ({
    id: `p${i}`,
    sectionId: 's',
    order: i,
    text: 'Text.',
    pageStart: null,
    kind: 'body',
    textHash: `${i}`,
  })),
};
const pairs: TransitionPair[] = Array.from({ length: 13 }, (_, i) => ({
  pairId: `p${i}->p${i + 1}`,
  sectionId: 's',
  sectionRole: 'methods',
  from: {
    paragraphId: `p${i}`,
    analysisId: paper.id,
    span: { start: 0, end: 1 },
    quote: 'T',
    sentence: 'Text.',
  },
  to: {
    paragraphId: `p${i + 1}`,
    analysisId: paper.id,
    span: { start: 0, end: 1 },
    quote: 'T',
    sentence: 'Text.',
  },
}));
it('P3 batches at 12, retries, validates and accounts for every request', async () => {
  const plan = planRun(paper, { sectionIds: ['s'], steps: ['transitions'], budget: 5 });
  const run: PaperRun = {
    schemaVersion: 1,
    id: paper.id,
    paperId: paper.id,
    createdAt: at,
    updatedAt: at,
    status: 'idle',
    plan,
    budget: 5,
    callsUsed: 0,
    promptVersions: {},
    model: 'fake',
    items: [],
  };
  let attempts = 0;
  const completeJson = vi.fn(async (options) => {
    await options.onRequest?.();
    if (attempts++ === 0) throw { status: 503 };
    const id = options.user.split(' | ')[0];
    return {
      data: options.schema.parse({
        pairs: [
          {
            pairId: id,
            continuity: 'shift',
            discourseRelation: 'none',
            linked: false,
            confidence: 0.8,
            rationale: 'Chuyển ý.',
          },
          {
            pairId: 'unknown',
            continuity: 'shift',
            discourseRelation: 'none',
            linked: false,
            confidence: 1,
            rationale: '',
          },
        ],
      }),
      meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
    };
  }) as LlmClient['completeJson'];
  const provider = createLlmParagraphTransition({ completeJson });
  let stored: PaperOverviewRecord['transitions'] = null;
  const sleep = vi.fn(async () => {});
  const result = await runBatch(run, {
    paper,
    analyze: async () => paper.id,
    save: async () => {},
    now: () => at,
    sleep,
    getTransitionPairs: async () => pairs,
    analyzeTransitions: async (chunk, onRequest) => {
      const value = await provider.analyze(chunk, stored?.findings, undefined, onRequest);
      stored = mergeTransitions(stored, value, at);
    },
  });
  expect(result.status).toBe('done');
  expect(result.callsUsed).toBe(3);
  expect(sleep).toHaveBeenCalledWith(1000);
  expect(completeJson).toHaveBeenCalledTimes(3);
  const options = vi.mocked(completeJson).mock.calls.map(([value]) => value);
  // Chunks run in parallel, so the lone pair may be sent while the failed chunk of 12 waits to retry.
  expect(options.map((value) => value.user.split('\n').length).sort((a, b) => a - b)).toEqual([1, 12, 12]);
  expect(
    options.every(
      (value) => value.promptVersion === 'para-flow-1' && value.schemaName === 'paragraph_transition',
    ),
  ).toBe(true);
  expect(stored).toMatchObject({ model: 'fake', promptVersion: 'para-flow-1' });
  const saved = stored as PaperOverviewRecord['transitions'];
  expect(saved?.pairs).toHaveLength(13);
  expect(saved?.judgements.filter((item) => item.measured)).toHaveLength(2);
  expect(saved?.judgements.filter((item) => !item.measured)).toHaveLength(11);
  expect(saved?.findings).toHaveLength(2);
  await expect(provider.analyze(pairs)).rejects.toThrow('At most 12');
});
