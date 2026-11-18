import { expect, it, vi } from 'vitest';
import { buildPaperModel } from '@/core/paperModel';
import { PROMPT_VERSIONS } from '@/core/prompts';
import type { Paper, ScgPaperRun } from '@/core/schemas';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { llmScg, SCG_PROMPT_VERSION } from './llmScg';

vi.mock('./consent', async (original) => ({
  ...(await original<typeof import('./consent')>()),
  requirePaperConsent: vi.fn(),
}));

const at = '2026-01-01T00:00:00.000Z';
const PAPER_ID = '00000000-0000-4000-8000-000000000001';
const paragraph = (id: string, sectionId: string, order: number, text: string) => ({
  id,
  sectionId,
  order,
  kind: 'body' as const,
  text,
  pageStart: 1,
  textHash: id,
});
const paper: Paper = {
  schemaVersion: 1,
  id: PAPER_ID,
  title: 'Synthetic',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'text', fileName: 'a', pageCount: 1, sha256: 'x' },
  sections: [
    { id: 'i', heading: 'Introduction', role: 'introduction', level: 1, pageStart: 1 },
    { id: 'm', heading: 'Method', role: 'methods', level: 1, pageStart: 1 },
    { id: 'r', heading: 'References', role: 'references', level: 1, pageStart: 1 },
  ],
  paragraphs: [
    paragraph('p1', 'i', 0, 'We propose the Foo encoder for parsing.'),
    paragraph('p2', 'm', 1, 'Foo builds on the Bar attention mechanism (Author, 2017).'),
    paragraph(
      'p3',
      'r',
      2,
      'Author, A. (2017). Bar attention for all. Journal of Tests. https://doi.org/10.1000/bar',
    ),
  ],
};
const model = buildPaperModel({ paper, metadata: null, now: new Date(at) });
const key = (text: string) => model.sentences.find((s) => s.text.includes(text))?.key ?? '';
const config = { model: 'requested' } as LlmConfig;
const other: ScgPaperRun = {
  schemaVersion: 1,
  paperId: 'other',
  doi: '10.1000/BAR',
  s2CorpusId: '555',
  s2CheckedAt: at,
  idBase: '555',
  promptVersion: SCG_PROMPT_VERSION,
  promptVersions: { contributions: 'a', prerequisites: 'b', alignment: 'c' },
  requestedModel: 'm',
  model: 'm',
  status: 'complete',
  callsUsed: 3,
  dropped: { quotes: 0, contributions: 0, prerequisites: 0, references: 0, matches: 0 },
  contributions: [
    {
      id: '555.c0',
      name: 'Bar attention mechanism',
      description: 'Attention for all.',
      types: [{ type: 'techniques_algorithms', explanation: '' }],
      sections: [],
      prerequisites: [],
      sourceSentenceKeys: ['0000000000000000#0'],
      review: 'candidate',
    },
  ],
  progress: { fingerprint: 'f', contributionBatches: {}, prerequisitesDone: [], alignmentDone: [] },
  reviewCarry: {},
  createdAt: at,
  updatedAt: at,
};

function fakeLlm(fail?: (schemaName: string, call: number) => boolean) {
  const calls: { schemaName: string; promptVersion: string; user: string }[] = [];
  const outputs: Record<string, (user: string) => unknown> = {
    scg_contributions: () => ({
      contributions: [
        {
          name: 'Foo encoder',
          description: 'An encoder for parsing.',
          types: [{ type: 'models_or_architectures', explanation: 'A new encoder.' }],
          sections: ['Introduction', 'Invented section'],
          evidence: [
            { sentenceKey: key('We propose'), quote: 'the Foo encoder' },
            { sentenceKey: key('We propose'), quote: 'not in the sentence' },
          ],
        },
        { name: 'Ghost', description: '', types: [], sections: [], evidence: [] },
      ],
    }),
    scg_prerequisites: (user) => ({
      prerequisites: [
        {
          contributionId: /(\S+\.c0):/u.exec(user)?.[1] ?? '',
          name: 'Bar attention',
          description: 'An attention mechanism.',
          explanation: 'Foo uses it.',
          coreOrPeripheral: 'core',
          references: [
            { refId: 'ref1', title: 'Bar attention for all' },
            { refId: 'ref99', title: null },
          ],
          internalContributionId: null,
          toolUrl: 'https://invented.example',
          evidence: [{ sentenceKey: key('Foo builds'), quote: 'Bar attention mechanism' }],
        },
        {
          contributionId: 'nobody.c9',
          name: 'Orphan',
          description: '',
          explanation: '',
          coreOrPeripheral: 'peripheral',
          references: [],
          internalContributionId: null,
          toolUrl: null,
          evidence: [{ sentenceKey: key('Foo builds'), quote: 'Foo' }],
        },
      ],
    }),
    scg_alignment: (user) => ({
      matches: [
        {
          prerequisiteId: /prerequisite id="([^"]+)"/u.exec(user)?.[1] ?? '',
          contributionId: '555.c0',
          matchType: 'strong',
          explanation: 'Same mechanism.',
        },
        { prerequisiteId: 'x', contributionId: '999.c0', matchType: 'weak', explanation: '' },
      ],
    }),
  };
  const client = {
    completeJson: async (request: Parameters<LlmClient['completeJson']>[0]) => {
      if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      await request.onRequest?.();
      calls.push({
        schemaName: request.schemaName,
        promptVersion: request.promptVersion,
        user: request.user,
      });
      if (fail?.(request.schemaName, calls.length)) throw new Error('Interrupted');
      return {
        data: request.schema.parse(outputs[request.schemaName]?.(request.user)),
        meta: { model: 'served', promptVersion: request.promptVersion, latencyMs: 1, repaired: false },
      };
    },
  } as LlmClient;
  return { client, calls };
}

it('SCG runs three anchored stages, fills references from the paper and aligns to the lab graph', async () => {
  const { client, calls } = fakeLlm();
  const lookupS2CorpusId = vi.fn(async () => '777');
  const run = await llmScg(client, model, {
    paperId: PAPER_ID,
    doi: '10.1/foo',
    config,
    others: [other],
    lookupS2CorpusId,
    now: () => at,
  });
  expect(calls.map((c) => [c.schemaName, c.promptVersion])).toEqual([
    ['scg_contributions', PROMPT_VERSIONS.scgContributions],
    ['scg_prerequisites', PROMPT_VERSIONS.scgPrerequisites],
    ['scg_alignment', PROMPT_VERSIONS.scgAlignment],
  ]);
  expect(SCG_PROMPT_VERSION).toBe('scg-contrib-1+scg-prereq-1+scg-align-1');
  expect(run.status).toBe('complete');
  expect(run.callsUsed).toBe(3);
  expect(run.model).toBe('served');
  expect(run.requestedModel).toBe('requested');
  expect(run.s2CorpusId).toBe('777');
  expect(run.idBase).toBe('777');
  expect(run.contributions).toHaveLength(1);
  const [contribution] = run.contributions;
  expect(contribution?.id).toBe('777.c0');
  expect(contribution?.sections).toEqual(['Introduction']);
  expect(contribution?.sourceSentenceKeys).toEqual([key('We propose')]);
  const prerequisite = contribution?.prerequisites[0];
  expect(prerequisite?.id).toBe('777.c0.p0');
  expect(prerequisite?.references).toEqual([
    {
      kind: 'paper',
      refId: 'ref1',
      title: 'Bar attention for all',
      year: 2017,
      doi: '10.1000/bar',
      s2CorpusId: null,
    },
  ]);
  expect(prerequisite?.matches).toEqual([
    { contributionId: '555.c0', matchType: 'strong', explanation: 'Same mechanism.', review: 'candidate' },
  ]);
  expect(run.dropped).toEqual({ quotes: 1, contributions: 1, prerequisites: 1, references: 2, matches: 1 });
});

it('SCG keeps going without an S2 id when the lookup is rate limited', async () => {
  const { client } = fakeLlm();
  const run = await llmScg(client, model, {
    paperId: PAPER_ID,
    doi: '10.1/foo',
    config,
    lookupS2CorpusId: async () => {
      throw new Error('HTTP 429');
    },
  });
  expect(run.s2CorpusId).toBeNull();
  expect(run.s2CheckedAt).toBeNull();
  expect(run.contributions[0]?.id).toBe(`${PAPER_ID}.c0`);
  // No other lab paper: alignment needs no call.
  expect(run.callsUsed).toBe(2);
});

it('SCG resumes at the stage that failed and keeps ids and reviews on a rerun', async () => {
  let saved: ScgPaperRun | undefined;
  const onProgress = async (run: ScgPaperRun) => {
    saved = structuredClone(run);
  };
  const failing = fakeLlm((name) => name === 'scg_prerequisites');
  await expect(
    llmScg(failing.client, model, { paperId: PAPER_ID, doi: null, config, onProgress }),
  ).rejects.toThrow('Interrupted');
  expect(saved?.status).toBe('prerequisites');
  expect(saved?.contributions).toHaveLength(1);
  const resumed = fakeLlm();
  const done = await llmScg(resumed.client, model, {
    paperId: PAPER_ID,
    doi: null,
    config,
    previous: saved,
    onProgress,
  });
  expect(resumed.calls.map((c) => c.schemaName)).toEqual(['scg_prerequisites']);
  expect(done.status).toBe('complete');
  expect(done.callsUsed).toBe(3);

  const reviewed = {
    ...done,
    idBase: 'kept',
    contributions: done.contributions.map((c) => ({ ...c, review: 'accepted' as const })),
  };
  const rerun = await llmScg(fakeLlm().client, model, {
    paperId: PAPER_ID,
    doi: '10.1/foo',
    config,
    previous: reviewed,
    lookupS2CorpusId: async () => '888',
  });
  expect(rerun.contributions[0]?.id).toBe('kept.c0');
  expect(rerun.contributions[0]?.review).toBe('accepted');
  expect(rerun.s2CorpusId).toBe('888');
  expect(rerun.callsUsed).toBe(2);
});

it('SCG stops on abort and leaves the checkpoint to resume from', async () => {
  const controller = new AbortController();
  let saved: ScgPaperRun | undefined;
  const { client, calls } = fakeLlm((name) => {
    if (name === 'scg_contributions') controller.abort();
    return false;
  });
  await expect(
    llmScg(client, model, {
      paperId: PAPER_ID,
      doi: null,
      config,
      signal: controller.signal,
      onProgress: async (run) => {
        saved = structuredClone(run);
      },
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(calls).toHaveLength(1);
  expect(saved?.status).toBe('prerequisites');
});
