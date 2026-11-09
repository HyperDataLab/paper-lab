import { beforeEach, expect, it, vi } from 'vitest';
import { BatchBudgetExceededError } from '@/core/batch/runBatch';
import { ExtractionOutputSchema, type Paper } from '@/core/schemas';
import { createLlmClient } from './client';
import { acceptConsent, revokeConsent } from './consent';
import { ConsentRequiredError } from './errors';
import { emptyCheckpoint, llmMeasurement, type MeasurementCheckpoint } from './llmMeasurement';

const config = { baseUrl: '/llm', model: 'test' };
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: 'T',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
  sections: [
    { id: 'a', heading: 'Abstract', role: 'abstract', level: 1, pageStart: null },
    { id: 'm', heading: 'Methods', role: 'methods', level: 1, pageStart: null },
  ],
  paragraphs: [
    { id: 'a1', sectionId: 'a', order: 0, text: 'We study x.', kind: 'body', pageStart: null, textHash: '' },
    {
      id: 'm1',
      sectionId: 'm',
      order: 0,
      text: 'We measure y.',
      kind: 'body',
      pageStart: null,
      textHash: '',
    },
  ],
};
const classify = JSON.stringify({ paper_type: 'EMPIRICAL', rationale: 'r', quotes: [] });
const extraction = JSON.stringify(
  ExtractionOutputSchema.parse({
    constructs: [],
    metrics: [],
    experiments: [],
    results: [],
    claims: [],
    taxonomy: [],
    review_method: null,
  }),
);
const reply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const links = JSON.stringify({
  metric_merges: [],
  result_links: [],
  metric_experiments: [],
  claim_links: [],
});
const findings = JSON.stringify({ findings: [] });
function setup(contents: string[], later = { link: links, findings }) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => {
    const body = String(init?.body);
    if (body.includes('"name":"measurement_links"')) return reply(later.link);
    if (body.includes('"name":"measurement_findings"')) return reply(later.findings);
    return reply(contents.shift() ?? extraction);
  });
  return { fetch, client: createLlmClient(config, { fetch, sleep: async () => {}, now: () => 0 }) };
}
const options = (over = {}) => ({
  sectionIds: ['a', 'm'],
  config,
  budget: 10,
  onRequest: vi.fn(async (_n: number) => {}),
  now: () => '2026-01-02T00:00:00.000Z',
  ...over,
});
beforeEach(() => {
  localStorage.clear();
  acceptConsent(config, true);
});

it('M2 classifies then extracts each unit and counts requests', async () => {
  const { client, fetch } = setup([classify, extraction, extraction]);
  const onUnit = vi.fn();
  const run = await llmMeasurement(client, paper, options({ onUnit }));
  expect(fetch).toHaveBeenCalledTimes(5);
  expect(run.callsUsed).toBe(5);
  expect(run.profile.status).toBe('complete');
  expect(run.profile.steps).toEqual({ link: 'done', findings: 'done' });
  expect(run.profile.coverage.analysed).toEqual(['a', 'm']);
  expect(onUnit).toHaveBeenLastCalledWith(2, 2);
});

it('M2 needs consent before any call', async () => {
  revokeConsent();
  const { client, fetch } = setup([]);
  await expect(llmMeasurement(client, paper, options())).rejects.toBeInstanceOf(ConsentRequiredError);
  expect(fetch).not.toHaveBeenCalled();
});

it('M2 stops at the budget and resumes from the checkpoint without repeating work', async () => {
  const first = setup([classify, extraction]);
  let saved: MeasurementCheckpoint = emptyCheckpoint();
  const onCheckpoint = async (value: MeasurementCheckpoint) => {
    saved = structuredClone(value);
  };
  await expect(
    llmMeasurement(first.client, paper, options({ budget: 2, onCheckpoint })),
  ).rejects.toBeInstanceOf(BatchBudgetExceededError);
  expect(saved.classification).not.toBeNull();
  expect(Object.keys(saved.units)).toEqual(['unit-1']);
  const second = setup([extraction]);
  const run = await llmMeasurement(second.client, paper, options({ checkpoint: saved, callsUsed: 2 }));
  expect(second.fetch).toHaveBeenCalledTimes(3);
  expect(run.callsUsed).toBe(5);
  expect(run.profile.status).toBe('complete');
});

it('AC-11 records a failed unit as not analysed and keeps going', async () => {
  const { client } = setup([classify, 'bad', 'bad', extraction, 'bad', 'bad']);
  const run = await llmMeasurement(client, paper, options());
  expect(run.failedUnits).toEqual(['unit-1']);
  expect(run.profile.status).toBe('partial');
  expect(run.profile.coverage.failed).toEqual(['a']);
  expect(run.profile.coverage.analysed).toEqual(['m']);
});

it('M2 retries a failed unit once and recovers', async () => {
  const { client, fetch } = setup([classify, 'bad', 'bad', extraction, extraction]);
  const run = await llmMeasurement(client, paper, options());
  expect(run.failedUnits).toEqual([]);
  expect(run.profile.status).toBe('complete');
  expect(fetch).toHaveBeenCalledTimes(7);
});

it('M3 marks the profile partial when linking fails and still runs findings', async () => {
  const { client } = setup([classify, extraction, extraction], { link: 'bad', findings });
  const run = await llmMeasurement(client, paper, options());
  expect(run.profile.status).toBe('partial');
  expect(run.profile.steps).toEqual({ link: 'failed', findings: 'done' });
});

it('M3 does not repeat finished steps and redoes them after new sections', async () => {
  const done: MeasurementCheckpoint = {
    classification: JSON.parse(classify),
    units: { 'unit-1': JSON.parse(extraction), 'unit-2': JSON.parse(extraction) },
    link: JSON.parse(links),
    findings: JSON.parse(findings),
    model: 'm',
  };
  const repeat = setup([]);
  await llmMeasurement(repeat.client, paper, options({ checkpoint: structuredClone(done) }));
  expect(repeat.fetch).not.toHaveBeenCalled();
  const partial = structuredClone(done);
  delete partial.units['unit-2'];
  const resumed = setup([extraction]);
  await llmMeasurement(resumed.client, paper, options({ checkpoint: partial }));
  expect(resumed.fetch).toHaveBeenCalledTimes(3);
});

it('M2 rejects an empty selection', async () => {
  const { client } = setup([]);
  await expect(llmMeasurement(client, paper, options({ sectionIds: [] }))).rejects.toThrow('Không có mục');
});
