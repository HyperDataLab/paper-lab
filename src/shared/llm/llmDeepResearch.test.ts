import { expect, it, vi } from 'vitest';
import { candidateFromWork } from '@/core/extraction';
import type { Candidate, ExtractionProject, SearchPlan } from '@/core/schemas';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { llmScreening, llmSearchPlan, llmSynthesis } from './llmDeepResearch';

vi.mock('./consent', async (original) => ({
  ...(await original<typeof import('./consent')>()),
  requirePaperConsent: vi.fn(),
}));

const config = { model: 'm' } as LlmConfig;
const reply = (data: unknown) =>
  vi.fn(async (request: Parameters<LlmClient['completeJson']>[0]) => {
    await request.onRequest?.();
    return {
      data: request.schema.parse(data),
      meta: { model: 'real', promptVersion: request.promptVersion, latencyMs: 1, repaired: false },
    };
  }) as unknown as LlmClient['completeJson'];

it('proposes a plan that still needs approval', async () => {
  const onRequest = vi.fn();
  const plan = await llmSearchPlan(
    {
      completeJson: reply({
        concepts: ['edge'],
        queries: ['edge latency'],
        inclusion: [],
        exclusion: [],
        fromYear: null,
        toYear: null,
      }),
    },
    'Độ trễ edge?',
    { config, onRequest },
  );
  expect(plan).toMatchObject({ queries: ['edge latency'], approvedAt: null });
  expect(onRequest).toHaveBeenCalledOnce();
});

it('suggests screening in batches for undecided candidates only', async () => {
  const make = (i: number) =>
    candidateFromWork({ id: `https://openalex.org/W${i}`, display_name: `T${i}` }, 'q') as Candidate;
  const list = [
    ...Array.from({ length: 11 }, (_, i) => make(i)),
    { ...make(99), status: 'excluded' as const },
  ];
  const completeJson = reply({ decisions: [{ key: 'W0', decision: 'included', reason: 'ok' }] });
  const next = await llmScreening(
    { completeJson },
    'RQ',
    { inclusion: [], exclusion: [] } as unknown as SearchPlan,
    list,
    { config },
  );
  expect(completeJson).toHaveBeenCalledTimes(2);
  expect(next[0]?.suggestion?.decision).toBe('included');
  expect(next[0]?.status).toBe('candidate');
});

it('synthesises from at least two papers and keeps only known references', async () => {
  const project = {
    title: 'P',
    researchQuestion: 'RQ',
    papers: ['a', 'b'].map((key) => ({
      key,
      title: key,
      year: null,
      access: 'FULL_TEXT',
      screening: 'included',
    })),
    fields: [{ key: 'results', label: 'Results', hidden: false }],
    cells: ['a', 'b'].map((paperKey) => ({ paperKey, fieldKey: 'results', value: 'v', status: 'EXTRACTED' })),
  } as unknown as ExtractionProject;
  const synthesis = await llmSynthesis(
    {
      completeJson: reply({
        claims: [{ kind: 'agreement', text: 'Giống nhau', paperKeys: ['P1', 'b', 'z'], caveat: null }],
      }),
    },
    project,
    { config, newId: () => '00000000-0000-4000-8000-000000000001', now: () => '2026-01-01T00:00:00.000Z' },
  );
  expect(synthesis).toMatchObject({
    paperKeys: ['a', 'b'],
    droppedRefs: 1,
    model: 'real',
    promptVersion: 'synthesis-2',
  });
  await expect(
    llmSynthesis({ completeJson: reply({ claims: [] }) }, { ...project, cells: [] }, { config }),
  ).rejects.toThrow();
});
