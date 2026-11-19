import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  canResume,
  contentOf,
  currentArtifact,
  currentResultsImport,
  selectedContent,
  selectable,
} from '@/core/autoresearch/artifacts';
import { completeDraft, csv, designFixture } from '@/core/autoresearch/ar3-fixtures';
import { prepareDesignApplication } from '@/core/autoresearch/apply-design';
import { STAGES } from '@/core/autoresearch/contracts';
import { argumentJudgments, at, charter, outputs, pi } from '@/core/autoresearch/fixtures';
import { approveCharter, decideGate, stageState } from '@/core/autoresearch/run';
import { importResults } from '@/core/autoresearch/import-results';
import { linkedFrozenPlan, planEtag, recordPlanLock } from '@/core/autoresearch/lock';
import { newProject } from '@/core/extraction';
import { snapshot } from '@/core/researchDesign/bank/testSupport';
import { confirmDesignCandidate } from '@/core/researchDesign/draft/designCandidates';
import { confirmCopiedHypothesis } from '@/core/autoresearch/copy';
import type { PapersDoc } from '@/core/researchDesign/papers';
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
  autoresearch_s10: designFixture(['h-agree']),
  autoresearch_s12: {
    narrative: 'Mean của Calibration là 8. Cần xem lại tiêu chí trước khi quyết định.',
    recommendation: 'refine',
  },
};

it('AR3 walks S1–S12 through storage, supervisors and human gates, then records a deviation', async () => {
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
        } else if (user.includes('"stage":"S12"')) {
          expect(user).toContain('preregisteredHypotheses');
          expect(options.system).toContain('integrity:post_hoc_criteria');
          answer = {
            next: {
              action: 'report',
              value: {
                points: [
                  {
                    id: 'omitted-control',
                    lens: 'integrity',
                    ref: 'integrity:suppressed_result',
                    itemId: 'h-agree',
                    severity: 'info',
                    fixClass: 'fix',
                    text: 'Summarize the control condition too.',
                  },
                ],
                resolutions: [],
              },
            },
          };
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
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).buffer;
  let researchDesign = await repo.researchDesigns.importBank(project.id, 0, bytes, 'human');
  const bank = await repo.researchDesigns.getBank(project.id);
  const papers: PapersDoc = { schemaVersion: 1, papers: [], log: [] };
  const freeze = (version: number, deviation: string | null) =>
    repo.researchDesigns.freeze(
      project.id,
      researchDesign.version,
      version,
      'human',
      deviation,
      papers,
      'test',
      { runId: run.id, revision: run.revision, designVersion: researchDesign.version },
    );
  const tools = projectTools({
    project,
    repo,
    getRun: () => run,
    requireConsent,
    bank,
    lab: null,
    scholar: createScholarClient({}),
  });
  const read = vi.fn(tools.read);
  run = await repo.autoresearch.save(await approveCharter(run, charter, at, null));
  let checkpoint;
  for (const stage of STAGES) {
    if (stage === 'S11') {
      const copy = await prepareDesignApplication(run, bank);
      const draft = completeDraft(copy(researchDesign.draft));
      expect(copy(draft)).toBe(draft);
      expect(draft.autoresearchDesign?.candidates.every((row) => row.status === 'candidate')).toBe(true);
      expect(draft.metrics[0]?.protocolBank).toMatchObject({
        id: 'mp.test-procedure',
        release: bank?.release,
      });
      researchDesign = await repo.researchDesigns.save({ ...researchDesign, draft }, researchDesign.version);
      await expect(freeze(1, null)).rejects.toThrow('cannot be frozen');
      let reviewed = draft;
      for (const h of draft.hypotheses) reviewed = confirmCopiedHypothesis(reviewed, h.id);
      researchDesign = await repo.researchDesigns.save(
        { ...researchDesign, draft: reviewed },
        researchDesign.version,
      );
      await expect(freeze(1, null)).rejects.toThrow('cannot be frozen');
      const proposal = reviewed.autoresearchDesign;
      if (!proposal) throw new Error('Missing S10 candidates');
      for (const row of proposal.candidates)
        reviewed = confirmDesignCandidate(reviewed, proposal.context.designHash, row.id);
      researchDesign = await repo.researchDesigns.save(
        { ...researchDesign, draft: reviewed },
        researchDesign.version,
      );
      researchDesign = await freeze(1, null);
      run = await repo.autoresearch.save(await recordPlanLock(run, researchDesign, 1, at));
      const plan = await linkedFrozenPlan(run, researchDesign);
      expect(currentArtifact(run, 'S11')).toMatchObject({
        author: 'person',
        status: 'accepted',
        content: { planVersion: 1, etag: await planEtag(plan), frozenAt: at },
      });
      expect(plan.context?.autoresearch).toMatchObject({
        runId: run.id,
        hypotheses: [{ sourceId: 'h-agree' }],
      });
      expect(run.decisions.at(-1)?.action).toBe('lock');
      run = await repo.autoresearch.save(await importResults(run, researchDesign, csv, 'csv'));
      continue;
    }
    run = await runStage(run, stage, {
      now: () => at,
      signal: controller.signal,
      requireConsent,
      bank,
      researchDesign,
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
  const analyzed = currentArtifact(run, 'S12');
  expect(analyzed && contentOf('S12', analyzed)).toMatchObject({
    resultsHash: currentResultsImport(run)?.hash,
    tests: [{ hypothesisId: 'h-agree', test: 'ttest_welch', verdict: 'supported' }],
  });
  expect(calls.some((call) => call.name === 'autoresearch_s11')).toBe(false);
  expect(stageState(run, 'S12').critic?.points[0]?.ref).toBe('integrity:suppressed_result');
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
  const replaced = await importResults(run, researchDesign, csv.replace('Suite,2,10', 'Suite,2,11'), 'csv');
  expect(currentArtifact(replaced, 'S12')).toBeUndefined();
  expect(currentArtifact(replaced, 'S11')).toEqual(currentArtifact(run, 'S11'));
  expect(currentResultsImport(replaced)?.hash).not.toBe(currentResultsImport(run)?.hash);
  expect(await canResume(replaced)).toBe(true);
  researchDesign = await repo.researchDesigns.save(
    {
      ...researchDesign,
      draft: { ...researchDesign.draft, planTitle: 'Clarify the plan title' },
    },
    researchDesign.version,
  );
  expect(researchDesign.planDeviation).toEqual({ runId: run.id, planVersion: 1, changedAt: at });
  await expect(freeze(2, null)).rejects.toThrow('cannot be frozen');
  researchDesign = await freeze(2, 'Clarified the title after lock.');
  expect(researchDesign.planDeviation).toBeUndefined();
  await expect(linkedFrozenPlan(run, researchDesign)).rejects.toThrow('newest frozen plan');
  run = await repo.autoresearch.save(await recordPlanLock(run, researchDesign, 2, at));
  expect(run.decisions.at(-1)).toMatchObject({
    action: 'deviation',
    note: 'Clarified the title after lock.',
  });
  expect(run.artifacts.find((a) => a.stage === 'S12')?.status).toBe('stale');
  expect(currentResultsImport(run)).toBeUndefined();
  expect(await canResume(run)).toBe(true);
  importedDb.close();
  db.close();
});

it('maps provider failures to AR1 codes', () => {
  expect(errorCode(new LlmHttpError(429, true))).toBe('LLM_RATE_LIMITED');
  expect(errorCode(new LlmTimeoutError())).toBe('LLM_TIMEOUT');
  expect(errorCode(new InvalidModelOutputError('schema', 'synthetic'))).toBe('LLM_OUTPUT_INVALID');
  expect(errorCode(new Error('synthetic'))).toBe('STAGE_ERROR');
});
