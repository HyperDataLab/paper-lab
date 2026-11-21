import { expect, it, vi } from 'vitest';
import { newCorpus } from '@/core/corpus';
import { addMember } from '@/core/corpus/intake';
import { recordDecision } from '@/core/corpus/screening';
import { corpusPlan, corpusQuestion, storeTriage, triageView } from '@/core/corpus/triage';
import { candidateFromWork } from '@/core/extraction';
import type { Candidate, ExtractionProject, SearchPlan } from '@/core/schemas';
import { createLlmClient, type LlmClient } from './client';
import type { LlmConfig } from './config';
import { llmScreening, llmSearchPlan, llmSynthesis, llmTriage } from './llmDeepResearch';

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

const triageReply = vi.fn(async (request: Parameters<LlmClient['completeJson']>[0]) => {
  await request.onRequest?.();
  const labels = [...request.user.matchAll(/^\[(P\d+)\]/gmu)].map((match) => match[1]);
  return {
    data: request.schema.parse({
      papers: labels.map((label) => ({
        label,
        relevance: 0.9,
        quality: 0.5,
        decision_suggestion: 'include',
        matched_criteria: ['I1'],
        reason: 'Đúng chủ đề',
      })),
    }),
    meta: { model: 'real', promptVersion: request.promptVersion, latencyMs: 1, repaired: false },
  };
}) as unknown as LlmClient['completeJson'];
const papers = (count: number) =>
  Array.from(
    { length: count },
    (_, i) =>
      candidateFromWork({ id: `https://openalex.org/W${i}`, display_name: `T${i}` }, 'q') as Candidate,
  );
const criteriaPlan = { inclusion: ['edge'], exclusion: ['simulation only'] };

it('R1 triages in batches of 18 with a checkpoint per batch, and resumes after a stop', async () => {
  vi.mocked(triageReply).mockClear();
  const abort = new AbortController();
  let saved = papers(40);
  const checkpoints: number[] = [];
  const first = await llmTriage({ completeJson: triageReply }, 'RQ', criteriaPlan, saved, {
    config,
    signal: abort.signal,
    onBatch: ({ apply, index, total }) => {
      saved = apply(saved);
      checkpoints.push(index + 1, total);
      abort.abort();
    },
  });
  expect(triageReply).toHaveBeenCalledTimes(1);
  expect(checkpoints).toEqual([1, 3]);
  expect(first.filter((item) => item.suggestion?.relevance === 0.9)).toHaveLength(18);
  expect(saved.filter((item) => item.suggestion)).toHaveLength(18);
  const prompt = vi.mocked(triageReply).mock.calls[0]![0];
  expect(prompt.system).toContain('I1: edge');
  expect(prompt.system).toContain('E1: simulation only');
  expect(prompt.promptVersion).toBe('screening-triage-1');

  const resumed = await llmTriage({ completeJson: triageReply }, 'RQ', criteriaPlan, saved, { config });
  expect(triageReply).toHaveBeenCalledTimes(3);
  expect(resumed.every((item) => item.suggestion?.relevance === 0.9 && item.status === 'candidate')).toBe(
    true,
  );
  expect(resumed[0]?.suggestion).toMatchObject({ model: 'real', matched: ['I1'] });
});

it('R1 grades against the research question when there are no criteria', async () => {
  vi.mocked(triageReply).mockClear();
  await llmTriage(
    { completeJson: triageReply },
    'Độ trễ edge?',
    { inclusion: [], exclusion: [] },
    papers(2),
    {
      config,
    },
  );
  expect(vi.mocked(triageReply).mock.calls[0]![0].system).toContain('research question only');
});

it('R1 repairs an invalid triage reply once through the client and validates it', async () => {
  const valid = JSON.stringify({
    papers: [
      {
        label: 'P1',
        relevance: 0.2,
        quality: null,
        decision_suggestion: 'exclude',
        matched_criteria: ['E1'],
        reason: 'Chỉ có simulation',
      },
    ],
  });
  const answers = ['{"papers":[{"label":"P1","relevance":"high"}]}', valid];
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: answers.shift() ?? valid } }] })),
  );
  const client = createLlmClient(
    { baseUrl: '/llm', model: 'test' },
    { fetch: fetchMock, sleep: async () => {}, now: () => 0 },
  );
  const next = await llmTriage(client, 'RQ', criteriaPlan, papers(1), { config });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(next[0]?.suggestion).toMatchObject({
    decision: 'excluded',
    relevance: 0.2,
    quality: null,
    matched: ['E1'],
  });
});

it('R1 corpus: triages a corpus screening list with a checkpoint per batch, and resumes after a stop', async () => {
  vi.mocked(triageReply).mockClear();
  const at = '2026-01-01T00:00:00.000Z';
  let corpus = newCorpus({
    id: 'c',
    kind: 'topic',
    title: 'Synthetic',
    createdAt: at,
    protocol: [
      {
        version: 1,
        createdAt: at,
        body: { researchQuestion: 'RQ', inclusion: ['edge'], exclusion: ['simulation only'], years: [] },
      },
    ],
  });
  for (let i = 0; i < 20; i++) {
    const added = addMember(corpus, { doi: `10.1000/r2-${i}`, title: `Member ${i}`, year: 2021 }, at);
    corpus = added.corpus;
  }
  // The first member is decided by a person before the run; triage leaves it alone.
  const decided = recordDecision(
    corpus,
    corpus.members[0]!.memberId,
    { stage: 'title-abstract', decision: 'include', person: 'An' },
    at,
  );
  if (!decided.ok) throw new Error('decide');
  let saved = decided.corpus;
  const abort = new AbortController();
  const run = (signal?: AbortSignal) =>
    llmTriage(
      { completeJson: triageReply },
      corpusQuestion(saved),
      corpusPlan(saved),
      triageView(saved, 'title-abstract'),
      {
        config,
        signal,
        onBatch: ({ apply }) => {
          const before = triageView(saved, 'title-abstract');
          saved = storeTriage(saved, 'title-abstract', before, apply(before), at);
          abort.abort();
        },
      },
    );
  await run(abort.signal);
  expect(triageReply).toHaveBeenCalledTimes(1);
  const triaged = () => saved.members.filter((member) => member.suggestions?.['title-abstract']).length;
  expect(triaged()).toBe(18);
  const prompt = vi.mocked(triageReply).mock.calls[0]![0];
  expect(prompt.system).toContain('Research question: RQ');
  expect(prompt.system).toContain('E1: simulation only');
  await run();
  expect(triageReply).toHaveBeenCalledTimes(2);
  expect(triaged()).toBe(19);
  expect(saved.members[0]?.suggestions).toBeUndefined();
  expect(saved.members[1]?.suggestions?.['title-abstract']).toMatchObject({
    relevance: 0.9,
    matched: ['I1'],
  });
  // Nothing left: a third run makes no call.
  await run();
  expect(triageReply).toHaveBeenCalledTimes(2);
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
    cells: ['a', 'b'].map((paperKey) => ({
      paperKey,
      fieldKey: 'results',
      value: 'v',
      status: 'EXTRACTED',
      evidence: [],
    })),
  } as unknown as ExtractionProject;
  const synthesis = await llmSynthesis(
    {
      completeJson: reply({
        claims: [{ kind: 'agreement', text: 'Giống nhau', paperKeys: ['P1.1', 'b', 'z'], caveat: null }],
      }),
    },
    project,
    { config, newId: () => '00000000-0000-4000-8000-000000000001', now: () => '2026-01-01T00:00:00.000Z' },
  );
  expect(synthesis).toMatchObject({
    paperKeys: ['a', 'b'],
    droppedRefs: 1,
    model: 'real',
    promptVersion: 'synthesis-3',
  });
  await expect(
    llmSynthesis({ completeJson: reply({ claims: [] }) }, { ...project, cells: [] }, { config }),
  ).rejects.toThrow();
});
