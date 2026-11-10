import { useStoredChanged } from './paperJobs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { runBatch, type BatchSignal } from '@/core/batch';
import type { Analysis, Paper, PaperRun, RunPlan } from '@/core/schemas';
import { createPaperParagraphAnalyzer, PAPER_PROMPT_VERSIONS } from '@/shared/llm/paperParagraphAnalyzer';
import { describeLlmError } from '@/shared/llm/describeError';
import { useLlm } from '@/shared/llm/LlmProvider';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { mergeTransitions, transitionPairs } from '@/core/paperOverview';
import { createLlmParagraphTransition } from '@/shared/llm/llmParagraphTransition';
import { captureCalibration } from '@/shared/calibration/data';

/** A failed paragraph shows this message to the reader, so it must not be a raw technical error. */
async function readableErrors<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    if (cause instanceof Error) cause.message = describeLlmError(cause) ?? cause.message;
    throw cause;
  }
}

export function useBatchRun(paper: Paper) {
  const repo = useRepositories();
  const notifyStoredChanged = useStoredChanged();
  const { client, config, ensureConsent } = useLlm();
  const [run, setRun] = useState<PaperRun | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const signal = useRef<BatchSignal>({});
  const busy = useRef(false);
  const refresh = useCallback(
    async () => setAnalyses(await repo.analyses.listByPaper(paper.id)),
    [repo, paper.id],
  );
  useEffect(() => {
    let active = true;
    void Promise.all([repo.paperRuns.listByPaper(paper.id), repo.analyses.listByPaper(paper.id)])
      .then(async ([runs, saved]) => {
        let latest = runs[0] ?? null;
        if (latest?.status === 'running') {
          latest = {
            ...latest,
            status: 'paused',
            items: latest.items.map((item) =>
              item.status === 'running' ? { ...item, status: 'pending' } : item,
            ),
          };
          await repo.paperRuns.save(latest);
        }
        if (active) {
          setRun(latest);
          setAnalyses(saved);
          setLoaded(true);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [paper.id, repo]);
  async function execute(value: PaperRun) {
    if (busy.current || !(await ensureConsent('paper'))) return;
    busy.current = true;
    signal.current = {};
    const analyzer = createPaperParagraphAnalyzer(client, repo, paper);
    try {
      const result = await runBatch(
        value,
        {
          paper,
          captureCalibration: () => captureCalibration(repo),
          recordCalibration: async (analysisId, step, snapshot) => {
            const analysis = await repo.analyses.get(analysisId);
            if (!analysis) throw new Error('Analysis not found');
            await repo.analyses.update(analysisId, {
              versions: {
                ...analysis.versions,
                calibrationSnapshots: { ...analysis.versions.calibrationSnapshots, [step]: snapshot },
              },
            });
          },
          ...analyzer,
          getTransitionPairs: async () => transitionPairs(paper, await repo.analyses.listByPaper(paper.id)),
          analyzeTransitions: async (pairs, onRequest) => {
            const current = await repo.paperOverviews.get(paper.id);
            if (!current) throw new Error('Paper not found');
            const old = current.transitions;
            const result = await createLlmParagraphTransition(client).analyze(
              pairs,
              old?.findings,
              undefined,
              onRequest,
            );
            const judgedAt = new Date().toISOString();
            await repo.paperOverviews.save({
              ...current,
              transitions: mergeTransitions(old, result, judgedAt),
            });
            notifyStoredChanged();
          },
          analyze: (...args) => readableErrors(() => analyzer.analyze(...args)),
          analyzeSyntaxBatch: (...args) => readableErrors(() => analyzer.analyzeSyntaxBatch(...args)),
          now: () => new Date().toISOString(),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          save: async (next) => {
            await repo.paperRuns.save(next);
            if (next.status === 'running') setRun(next);
            await refresh();
            notifyStoredChanged();
          },
        },
        signal.current,
      );
      busy.current = false;
      setRun(result);
    } catch (cause) {
      setError(String(cause));
    } finally {
      busy.current = false;
    }
  }
  async function start(plan: RunPlan) {
    if (busy.current || !(await ensureConsent('paper'))) return;
    const now = new Date().toISOString();
    const value: PaperRun = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      paperId: paper.id,
      createdAt: now,
      updatedAt: now,
      status: 'idle',
      plan,
      budget: plan.budget,
      callsUsed: 0,
      callsByStep: {},
      calibrationSnapshots: {},
      promptVersions: PAPER_PROMPT_VERSIONS,
      model: config.model,
      items: plan.paragraphs.map((p) => ({
        paragraphId: p.paragraphId,
        textHash: p.textHash,
        analysisId: null,
        status: 'pending',
        stepsDone: [],
        calls: 0,
        error: null,
      })),
    };
    try {
      await repo.paperRuns.create(value);
      setRun(value);
      await execute(value);
    } catch (cause) {
      setError(String(cause));
    }
  }
  function retry(paragraphId: string) {
    if (!run) return;
    const value: PaperRun = {
      ...run,
      items: run.items.map((item) =>
        item.paragraphId === paragraphId ? { ...item, status: 'pending', error: null } : item,
      ),
    };
    void execute(value);
  }
  return {
    run,
    loaded,
    analyses,
    error,
    start,
    resume: (budget: number) =>
      run &&
      void execute(
        run.status === 'budget_exceeded'
          ? { ...run, budget, plan: { ...run.plan, budget, withinBudget: run.plan.total <= budget } }
          : run,
      ),
    retry,
    pause: () => {
      signal.current.action = 'pause';
    },
    cancel: () => {
      if (busy.current) signal.current.action = 'cancel';
      else if (run) {
        const cancelled: PaperRun = { ...run, status: 'cancelled', updatedAt: new Date().toISOString() };
        void repo.paperRuns
          .save(cancelled)
          .then(setRun)
          .catch((cause: unknown) => setError(String(cause)));
      }
    },
  };
}
