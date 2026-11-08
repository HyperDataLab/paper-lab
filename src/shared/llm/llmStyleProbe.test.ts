import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { probeAt, probeFixture } from '@/test/probeFixtures';
import { createLlmClient } from './client';
import { acceptConsent } from './consent';
import { ConsentRequiredError } from './errors';
import { createStyleProbeRun, estimateProbe, llmStyleProbe } from './llmStyleProbe';
import { validateParagraphStructure } from '@/core/paragraph/validateParagraphStructure';
import { ParagraphStructureOutputSchema } from '@/core/prompts';

const config = { baseUrl: '/llm', model: 'test' };
const runId = '00000000-0000-4000-8000-000000000099';
const structure = ParagraphStructureOutputSchema.parse({
  type: 'LD',
  typeScores: { 'TS-D': 0, LD: 0.9, LDR: 0, OCAR: 0, UNKNOWN: 0.1 },
  centralPointSentenceId: null,
  identifiability: 2,
  evidence: '',
  roles: [],
  offTopicSentenceIds: [],
  unityRationale: '',
  pairs: [],
  rationale: '',
});
function setup() {
  const calls: string[] = [];
  const prompts: { name: string; user: string }[] = [];
  let failFirst = false;
  let identical = false;
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, request) => {
    const body = JSON.parse(String(request?.body)) as {
      response_format: { json_schema: { name: string } };
      messages: { content: string }[];
    };
    const name = body.response_format.json_schema.name;
    calls.push(name);
    if (failFirst) {
      failFirst = false;
      return new Response('', { status: 429 });
    }
    const user = body.messages[1]?.content ?? '';
    prompts.push({ name, user });
    const number = user.match(/experiment (\d+)/)?.[1] ?? '0';
    const data =
      name === 'style_probe'
        ? { rewritten: identical ? user : `The experiment is described by the method ${number}.` }
        : name === 'sentence_syntax'
          ? { sentences: [] }
          : name === 'candidate_judgement'
            ? { judgements: [], passive: [] }
            : name === 'paragraph_structure'
              ? structure
              : {
                  dimensions: ['verb_word_choice', 'concision_modifiers', 'paragraph_organization'].map(
                    (id) => ({
                      id,
                      rubric: 2,
                      confidence: 1,
                      evidenceIssueIds: [],
                      evidenceSentenceIds: [],
                      rationale: '',
                    }),
                  ),
                };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) } }] }), {
      status: 200,
    });
  });
  return {
    calls,
    prompts,
    fetch,
    client: createLlmClient(config, { fetch, sleep: async () => {}, now: () => 0 }),
    retry: () => {
      failFirst = true;
    },
    discard: () => {
      identical = true;
    },
  };
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
});

it('P6 plans with the newest compatible score and refuses incompatible samples', async () => {
  const { paper, analyses } = await probeFixture();
  const first = analyses[0];
  if (!first) throw new Error('fixture');
  const newer = structuredClone(first);
  newer.id = '00000000-0000-4000-8000-000000000098';
  newer.updatedAt = '2026-02-01T00:00:00.000Z';
  newer.versions.scoringModel = 'other';
  const options = { n: 10, budget: 50, model: 'test', id: runId, now: probeAt };
  const run = createStyleProbeRun(paper, [...analyses, newer], options);
  expect(run.analysisIds).toContain(first.id);
  expect(run.analysisIds).not.toContain(newer.id);
  expect(() => createStyleProbeRun(paper, [first, newer, ...analyses.slice(1, 2)], options)).toThrow(
    'Cần chấm điểm ít nhất 3 đoạn trước',
  );
});

it('P6 recomputes paragraph structure with paper context before scoring and estimates the call', async () => {
  acceptConsent(config, true);
  const { paper, analyses } = await probeFixture();
  analyses.forEach((analysis) => {
    analysis.paragraph = validateParagraphStructure(structure, analysis.text, []).paragraph;
  });
  const run = createStyleProbeRun(paper, analyses, {
    n: 3,
    budget: 15,
    model: 'test',
    id: runId,
    now: probeAt,
  });
  expect(estimateProbe(analyses.filter((a) => run.analysisIds.includes(a.id)))).toBe(15);
  const { client, calls, prompts } = setup();
  const result = await llmStyleProbe(client, paper, analyses, run, {
    config,
    now: () => probeAt,
    save: async () => {},
  });
  expect(result.callsUsed).toBe(15);
  expect(calls).toEqual(
    Array(3).fill(['style_probe', 'sentence_syntax', 'paragraph_structure', 'scoring', 'scoring']).flat(),
  );
  expect(prompts.find((p) => p.name === 'paragraph_structure')?.user).toContain('Section role: methods');
  expect(
    result.items[0]?.rewritten?.dimensions.find((d) => d.id === 'paragraph_organization')?.applicable,
  ).toBe(true);
});

it('P6 performs sequential calls and checkpoints each paragraph, with optional judgement', async () => {
  acceptConsent(config, true);
  const { paper, analyses } = await probeFixture();
  analyses.forEach((a) => {
    a.versions.judgePrompt = 'cand-judge-paper-1';
  });
  const run = createStyleProbeRun(paper, analyses, {
    n: 3,
    budget: 20,
    model: 'test',
    id: runId,
    now: probeAt,
  });
  const { client, calls } = setup();
  const checkpoints: number[] = [];
  const result = await llmStyleProbe(client, paper, analyses, run, {
    config,
    now: () => probeAt,
    save: async (r) => {
      checkpoints.push(r.items.length);
    },
  });
  expect(result.status).toBe('done');
  expect(result.callsUsed).toBe(15);
  expect(calls).toEqual(
    Array(3).fill(['style_probe', 'sentence_syntax', 'candidate_judgement', 'scoring', 'scoring']).flat(),
  );
  expect(checkpoints).toEqual(expect.arrayContaining([0, 1, 2, 3]));
});

it('P6 counts retries and stops before exceeding budget, then resumes from checkpoint', async () => {
  acceptConsent(config, true);
  const { paper, analyses } = await probeFixture();
  const run = createStyleProbeRun(paper, analyses, {
    n: 3,
    budget: 5,
    model: 'test',
    id: runId,
    now: probeAt,
  });
  const mock = setup();
  mock.retry();
  const options = { config, now: () => probeAt, save: async () => {} };
  const stopped = await llmStyleProbe(mock.client, paper, analyses, run, options);
  expect(stopped.status).toBe('budget_exceeded');
  expect(stopped.callsUsed).toBe(5);
  expect(stopped.items).toHaveLength(1);
  expect(mock.fetch).toHaveBeenCalledTimes(5);
  const resumed = await llmStyleProbe(mock.client, paper, analyses, { ...stopped, budget: 20 }, options);
  expect(resumed.status).toBe('done');
  expect(resumed.items).toHaveLength(3);
  expect(resumed.callsUsed).toBe(13);
});

it('P6 cancels at a checkpoint and resumes without repeating completed paragraphs', async () => {
  acceptConsent(config, true);
  const { paper, analyses } = await probeFixture();
  const run = createStyleProbeRun(paper, analyses, {
    n: 3,
    budget: 20,
    model: 'test',
    id: runId,
    now: probeAt,
  });
  const mock = setup();
  const controller = new AbortController();
  const stopped = await llmStyleProbe(mock.client, paper, analyses, run, {
    config,
    now: () => probeAt,
    signal: controller.signal,
    save: async (r) => {
      if (r.items.length === 1) controller.abort();
    },
  });
  expect(stopped.status).toBe('cancelled');
  expect(stopped.items).toHaveLength(1);
  const resumed = await llmStyleProbe(mock.client, paper, analyses, stopped, {
    config,
    now: () => probeAt,
    save: async () => {},
  });
  expect(resumed.status).toBe('done');
  expect(mock.calls.filter((name) => name === 'style_probe')).toHaveLength(3);
});

it('P6 discards unchanged rewrites without scoring and requires manuscript consent', async () => {
  const { paper, analyses } = await probeFixture();
  const run = createStyleProbeRun(paper, analyses, {
    n: 3,
    budget: 10,
    model: 'test',
    id: runId,
    now: probeAt,
  });
  const mock = setup();
  const options = { config, now: () => probeAt, save: async () => {} };
  await expect(llmStyleProbe(mock.client, paper, analyses, run, options)).rejects.toBeInstanceOf(
    ConsentRequiredError,
  );
  acceptConsent(config, true);
  mock.discard();
  const result = await llmStyleProbe(mock.client, paper, analyses, run, options);
  expect(result.items).toHaveLength(3);
  expect(result.items.every((item) => item.reasons.length > 0 && item.rewritten === null)).toBe(true);
  expect(mock.calls).toEqual(['style_probe', 'style_probe', 'style_probe']);
});

it('P6 rejects changed source, scorer, model and invalid plans before a request', async () => {
  acceptConsent(config, true);
  const { paper, analyses } = await probeFixture();
  const run = createStyleProbeRun(paper, analyses, {
    n: 3,
    budget: 10,
    model: 'test',
    id: runId,
    now: probeAt,
  });
  const mock = setup();
  const options = { config, now: () => probeAt, save: async () => {} };
  await expect(
    llmStyleProbe(mock.client, paper, analyses, { ...run, model: 'other' }, options),
  ).rejects.toThrow('plan');
  const changed = structuredClone(analyses);
  const selected = changed.find((a) => a.id === run.analysisIds[0]);
  if (!selected) throw new Error('fixture');
  selected.versions.scoringModel = 'other';
  await expect(llmStyleProbe(mock.client, paper, changed, run, options)).rejects.toThrow('source changed');
  expect(mock.calls).toHaveLength(0);
});

it('P6 cancels before a request and can resume after consent is restored', async () => {
  acceptConsent(config, true);
  const { paper, analyses } = await probeFixture();
  const run = createStyleProbeRun(paper, analyses, {
    n: 3,
    budget: 20,
    model: 'test',
    id: runId,
    now: probeAt,
  });
  const mock = setup();
  const controller = new AbortController();
  controller.abort();
  const stopped = await llmStyleProbe(mock.client, paper, analyses, run, {
    config,
    now: () => probeAt,
    save: async () => {},
    signal: controller.signal,
  });
  expect(stopped.status).toBe('cancelled');
  expect(stopped.callsUsed).toBe(0);
  expect(mock.calls).toHaveLength(0);
});
