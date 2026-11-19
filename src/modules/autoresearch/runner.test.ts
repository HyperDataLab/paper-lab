import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canResume, currentArtifact, selectedContent, selectable } from '@/core/autoresearch/artifacts';
import { STAGES } from '@/core/autoresearch/contracts';
import { argumentJudgments, at, charter, outputs, pi } from '@/core/autoresearch/fixtures';
import { approveCharter, decideGate, stageState } from '@/core/autoresearch/run';
import { newProject } from '@/core/extraction';
import { runStage, errorCode } from '@/shared/autoresearch/runner';
import { projectTools } from '@/shared/autoresearch/project-tools';
import { defaultScreen } from '@/shared/autoresearch/screening';
import type { LlmClient } from '@/shared/llm/client';
import { acceptConsent } from '@/shared/llm/consent';
import { LlmHttpError, LlmTimeoutError, InvalidModelOutputError } from '@/shared/llm/errors';
import { createScholarClient } from '@/shared/scholar/client';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
const config = { baseUrl: '/llm', model: 'synthetic-lead', criticModel: 'synthetic-critic' };
const answerFor = {
  autoresearch_s1: outputs.S1.goal,
  autoresearch_s2: {
    subQuestions: outputs.S2.subQuestions,
    rationale: outputs.S2.rationale,
    scores: outputs.S2.scores,
  },
  autoresearch_s3: outputs.S3,
  screening: {
    decisions: [{ key: 'title:fictional study', decision: 'included', reason: 'Reports reviewer outcomes.' }],
  },
  autoresearch_s6: { cards: outputs.S6.cards.map((card) => ({ ...card, quote_anchors: [] })) },
  autoresearch_s7: outputs.S7,
  autoresearch_s8: {
    hypotheses: outputs.S8.hypotheses,
    perspectives: outputs.S8.perspectives,
    debateRounds: outputs.S8.debateRounds,
  },
  autoresearch_s9: argumentJudgments(['h-agree']),
};

it('AR2 walks S1–S9 through storage, both supervisors, shared screening and human gates', async () => {
  const db = createDb(crypto.randomUUID());
  const repo = createRepositories(db, () => new Date(at));
  const project = await repo.extraction.save(
    newProject({
      id: crypto.randomUUID(),
      title: 'Synthetic calibration',
      researchQuestion: charter.question,
      now: at,
    }),
  );
  const scripted = new Set<string>();
  const calls: { name: string; model: string }[] = [];
  const mock = (model: string): LlmClient => ({
    async completeJson(options) {
      const { schemaName: name, schema, promptVersion, user } = options;
      await options.onRequest?.();
      calls.push({ name, model });
      let answer: unknown;
      if (name === 'autoresearch_critic') {
        expect(model).toBe(config.criticModel);
        if (!scripted.has('critic')) {
          scripted.add('critic');
          answer = { next: { action: 'read_notebook', input: null } };
        } else if (user.includes('"stage":"S9"') && !scripted.has('critic-map')) {
          scripted.add('critic-map');
          answer = { next: { action: 'read_artifact', input: 'S9:1' } };
        } else answer = { next: { action: 'report', value: { points: [], resolutions: [] } } };
      } else if (name === 'autoresearch_pi') {
        expect(model).toBe(config.model);
        if (!scripted.has('pi')) {
          scripted.add('pi');
          answer = { next: { action: 'decide', value: { ...pi, selectionIds: ['invented'] } } };
        } else if (user.includes('"stage":"S9"') && !scripted.has('pi-map')) {
          scripted.add('pi-map');
          answer = { next: { action: 'read_artifact', input: 'S9' } };
        } else {
          if (!scripted.has('retried')) {
            expect(user).toContain('UNKNOWN_SELECTION');
            scripted.add('retried');
          }
          answer = { next: { action: 'decide', value: pi } };
        }
      } else answer = answerFor[name as keyof typeof answerFor];
      return { data: schema.parse(answer), meta: { model, promptVersion, latencyMs: 0, repaired: false } };
    },
  });
  const lead = mock(config.model);
  const controller = new AbortController();
  const screen = vi.fn((options: Parameters<typeof defaultScreen>[0]) => defaultScreen(options));
  const requireConsent = vi.fn();
  acceptConsent(config, true, true);
  let run = await repo.autoresearch.create(project.id, 100);
  const tools = projectTools({
    project,
    repo,
    getRun: () => run,
    requireConsent,
    bank: null,
    lab: null,
    scholar: createScholarClient({}),
  });
  const read = vi.fn(tools.read);
  run = await repo.autoresearch.save(await approveCharter(run, charter, at, null));
  let checkpoint;
  for (const stage of STAGES) {
    run = await runStage(run, stage, {
      now: () => at,
      signal: controller.signal,
      requireConsent,
      lead: { model: config.model, client: lead },
      critic: { model: config.criticModel, client: mock(config.criticModel) },
      collect: async () => outputs.S4,
      loadFullTexts: async () => new Map(),
      search: async () => [],
      read,
      screen: (progress) => screen({ ...progress, client: lead, config }),
      save: async (next) => {
        const saved = await repo.autoresearch.save(next);
        if (next.pipeline.some((row) => row.criticProgress.pending)) checkpoint = saved;
        run = saved;
        return saved;
      },
    });
    expect(stageState(run, stage)).toMatchObject({
      state: 'gate',
      error: null,
      reviewError: null,
      models: { sharedModel: false },
      critic: { verdict: 'sound' },
      pi: { action: 'accept' },
    });
    expect(currentArtifact(run, stage)?.status).toBe('draft');
    expect(await canResume(run)).toBe(true);
    const ids = selectable(currentArtifact(run, stage)).map((item) => item.id);
    const kept = stage === 'S8' ? ids.slice(0, 1) : ids;
    run = await repo.autoresearch.save(
      await decideGate(
        run,
        stage,
        {
          approve: true,
          ids: kept,
          primaryId: stage === 'S8' ? 'h-agree' : null,
          note: null,
        },
        at,
      ),
    );
  }
  const stored = await repo.autoresearch.get(run.id);
  expect(stored).toMatchObject({
    status: 'ended',
    endReason: 'complete',
    budget: { calls: calls.length, estimatedCost: null },
  });
  expect(checkpoint).toBeDefined();
  expect(requireConsent).toHaveBeenCalled();
  expect(read).toHaveBeenCalledWith('read_artifact', 'S9:1');
  expect(read).toHaveBeenCalledWith('read_artifact', 'S9');
  expect(await tools.read('read_artifact', 'S4')).toMatchObject({ stage: 'S4', content: outputs.S4 });
  expect(await tools.read('read_artifact', 'S6')).toMatchObject({
    stage: 'S6',
    content: answerFor.autoresearch_s6,
  });
  expect(await tools.read('read_artifact', 'S9')).toMatchObject({
    stage: 'S9',
    content: {
      graph: { entities: expect.arrayContaining([expect.objectContaining({ id: 'hypothesis:h-agree' })]) },
    },
  });
  expect(calls.filter((call) => call.name === 'screening')).toHaveLength(1);
  const artifact = currentArtifact(run, 'S8');
  expect(artifact && selectedContent('S8', artifact).hypotheses.map((h) => h.id)).toEqual(['h-agree']);
  const backup = await repo.transfer.exportAll('synthetic');
  const importedDb = createDb(crypto.randomUUID());
  const imported = createRepositories(importedDb);
  const preview = await imported.transfer.previewImport(backup);
  expect(preview.ok).toBe(true);
  if (preview.ok) await imported.transfer.applyImport(preview);
  expect(await imported.autoresearch.get(run.id)).toEqual(stored);
  importedDb.close();
  db.close();
});

it('maps provider failures to AR1 codes', () => {
  expect(errorCode(new LlmHttpError(429, true))).toBe('LLM_RATE_LIMITED');
  expect(errorCode(new LlmTimeoutError())).toBe('LLM_TIMEOUT');
  expect(errorCode(new InvalidModelOutputError('schema', 'synthetic'))).toBe('LLM_OUTPUT_INVALID');
  expect(errorCode(new Error('synthetic'))).toBe('STAGE_ERROR');
});
