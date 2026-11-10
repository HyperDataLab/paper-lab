import { expect, it, vi } from 'vitest';
import { catalogField } from '@/core/extraction';
import type { ExtractionProject, Paper, ProjectField } from '@/core/schemas';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { llmExtraction } from './llmExtraction';

vi.mock('./consent', async (original) => ({
  ...(await original<typeof import('./consent')>()),
  requirePaperConsent: vi.fn(),
}));

const at = '2026-01-01T00:00:00.000Z';
const PAPER = '00000000-0000-4000-8000-000000000001';
const paper: Paper = {
  schemaVersion: 1,
  id: PAPER,
  title: 'T',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'pdf', fileName: 'a.pdf', pageCount: 1, sha256: 'x' },
  sections: [{ id: 's', heading: 'Methods', role: 'methods', level: 1, pageStart: 1 }],
  paragraphs: [
    {
      id: 'p',
      sectionId: 's',
      order: 0,
      text: 'We used a survey.',
      kind: 'body',
      textHash: 'p',
      pageStart: 1,
    },
  ],
};
const fields = ['methods_used', 'dataset'].map((key) => ({
  ...(catalogField(key) as ProjectField),
  hidden: false,
}));
const project = (): ExtractionProject => ({
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000003',
  title: 'P',
  researchQuestion: '',
  createdAt: at,
  updatedAt: at,
  papers: [
    {
      key: 'a',
      source: { kind: 'paper', paperId: PAPER },
      title: 'A',
      authors: [],
      year: null,
      venue: null,
      doi: null,
      access: 'FULL_TEXT',
      abstract: null,
      revision: 'r1',
      screening: 'included',
    },
    {
      key: 'b',
      source: { kind: 'library', libraryId: '00000000-0000-4000-8000-000000000004' },
      title: 'B',
      authors: [],
      year: null,
      venue: null,
      doi: '10.1/b',
      access: 'METADATA_ONLY',
      abstract: null,
      revision: 'r1',
      screening: 'included',
    },
  ],
  fields,
  runs: [],
  cells: [],
  deep: null,
});
const answer = {
  fields: [
    {
      field_key: 'methods_used',
      status: 'found',
      value: 'Survey',
      inferred: false,
      evidence: [{ paragraphId: 'p', quote: 'a survey' }],
    },
    { field_key: 'dataset', status: 'not_found', value: null, inferred: false, evidence: [] },
  ],
};
const fake = (fail?: () => Error) =>
  vi.fn(async (request: Parameters<LlmClient['completeJson']>[0]) => {
    await request.onRequest?.();
    const error = fail?.();
    if (error) throw error;
    return {
      data: request.schema.parse(answer),
      meta: { model: 'real', promptVersion: request.promptVersion, latencyMs: 1, repaired: false },
    };
  }) as unknown as LlmClient['completeJson'];
const run = (completeJson: LlmClient['completeJson'], budget = 5) => {
  const save = vi.fn(async (_value: ExtractionProject) => {});
  return {
    save,
    result: llmExtraction({ completeJson }, project(), new Map([[PAPER, paper]]), {
      paperKeys: ['a', 'b'],
      fieldKeys: ['methods_used', 'dataset'],
      mode: 'STANDARD',
      keepVerified: true,
      config: { model: 'm' } as LlmConfig,
      budget,
      save,
      newId: () => '00000000-0000-4000-8000-000000000002',
      now: () => at,
    }),
  };
};

it('extracts readable papers, marks metadata-only ones and saves after each paper', async () => {
  const completeJson = fake();
  const { result, save } = run(completeJson);
  const done = await result;
  expect(completeJson).toHaveBeenCalledTimes(1);
  expect(done.runs[0]).toMatchObject({ status: 'COMPLETED', callsUsed: 1, model: 'real', mode: 'STANDARD' });
  const by = (paperKey: string, fieldKey: string) =>
    done.cells.find((item) => item.paperKey === paperKey && item.fieldKey === fieldKey);
  expect(by('a', 'methods_used')).toMatchObject({ status: 'EXTRACTED', value: 'Survey' });
  expect(by('a', 'dataset')?.status).toBe('NOT_FOUND');
  expect(by('b', 'methods_used')?.status).toBe('INSUFFICIENT_SOURCE');
  expect(save.mock.calls.length).toBeGreaterThanOrEqual(4);
});
it('keeps going past a failed request and marks those cells failed', async () => {
  const { result } = run(fake(() => new Error('bad output')));
  const done = await result;
  expect(done.runs[0]?.status).toBe('PARTIAL');
  expect(done.runs[0]?.errors).toHaveLength(1);
  expect(done.cells.find((item) => item.paperKey === 'a')?.status).toBe('FAILED');
});
it('stops at the budget and on cancel without losing the run', async () => {
  expect((await run(fake(), 0).result).runs[0]?.status).toBe('PARTIAL');
  expect((await run(fake(() => new DOMException('stop', 'AbortError'))).result).runs[0]?.status).toBe(
    'CANCELLED',
  );
});

it('High Quality retries an unsupported value once, then verifies and records it as automated', async () => {
  const replies = [
    {
      fields: [
        {
          field_key: 'methods_used',
          status: 'found',
          value: 'Survey',
          inferred: false,
          evidence: [{ paragraphId: 'p', quote: 'a survey' }],
        },
        { field_key: 'dataset', status: 'found', value: 'Panel data', inferred: false, evidence: [] },
      ],
    },
    { fields: [{ field_key: 'dataset', status: 'not_found', value: null, inferred: false, evidence: [] }] },
    { checks: [{ field_key: 'methods_used', verdict: 'SUPPORTED', note: 'ok', conflicts: [] }] },
  ];
  const completeJson = vi.fn(async (request: Parameters<LlmClient['completeJson']>[0]) => {
    await request.onRequest?.();
    return {
      data: request.schema.parse(replies.shift()),
      meta: { model: 'real', promptVersion: request.promptVersion, latencyMs: 1, repaired: false },
    };
  }) as unknown as LlmClient['completeJson'];
  const done = await llmExtraction({ completeJson }, project(), new Map([[PAPER, paper]]), {
    paperKeys: ['a'],
    fieldKeys: ['methods_used', 'dataset'],
    mode: 'HIGH_QUALITY',
    keepVerified: true,
    config: { model: 'm' } as LlmConfig,
    budget: 10,
    save: vi.fn(async () => {}),
    newId: () => '00000000-0000-4000-8000-000000000002',
    now: () => at,
  });
  expect(completeJson).toHaveBeenCalledTimes(3);
  expect(done.runs[0]).toMatchObject({
    status: 'COMPLETED',
    callsUsed: 3,
    promptVersion: 'extraction-1+extraction-verify-1',
  });
  expect(done.cells.find((item) => item.fieldKey === 'methods_used')).toMatchObject({
    verification: 'AUTOMATED',
    verdict: 'SUPPORTED',
  });
  expect(done.cells.find((item) => item.fieldKey === 'dataset')?.status).toBe('NOT_FOUND');
});
it('High Quality keeps a cell as it was when its retry or verification fails', async () => {
  let call = 0;
  const completeJson = vi.fn(async (request: Parameters<LlmClient['completeJson']>[0]) => {
    await request.onRequest?.();
    call++;
    if (call > 1) throw new Error('bad output');
    return {
      data: request.schema.parse(answer),
      meta: { model: 'real', promptVersion: request.promptVersion, latencyMs: 1, repaired: false },
    };
  }) as unknown as LlmClient['completeJson'];
  const done = await llmExtraction({ completeJson }, project(), new Map([[PAPER, paper]]), {
    paperKeys: ['a'],
    fieldKeys: ['methods_used', 'dataset'],
    mode: 'HIGH_QUALITY',
    keepVerified: true,
    config: { model: 'm' } as LlmConfig,
    budget: 10,
    save: vi.fn(async () => {}),
    newId: () => '00000000-0000-4000-8000-000000000002',
    now: () => at,
  });
  expect(done.runs[0]?.status).toBe('PARTIAL');
  expect(done.cells.find((item) => item.fieldKey === 'methods_used')).toMatchObject({
    status: 'EXTRACTED',
    verdict: null,
  });
});
