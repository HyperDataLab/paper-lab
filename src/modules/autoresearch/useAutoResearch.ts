import { useEffect, useRef, useState } from 'react';
import type { Stage } from '@/core/autoresearch/contracts';
import { STAGES } from '@/core/autoresearch/contracts';
import { editArtifact } from '@/core/autoresearch/edit';
import type { Run } from '@/core/autoresearch/record';
import { endRun } from '@/core/autoresearch/run';
import { importResults } from '@/core/autoresearch/import-results';
import { recordPlanLock } from '@/core/autoresearch/lock';
import type { BankDoc } from '@/core/researchDesign/bank/snapshot';
import type { ExtractionProject } from '@/core/schemas';
import { defaultScreen } from '@/shared/autoresearch/screening';
import { projectTools } from '@/shared/autoresearch/project-tools';
import { modelsFor, runStage } from '@/shared/autoresearch/runner';
import { useAuth } from '@/shared/auth/authContext';
import { createLabResearchClient, LAB_RESEARCH_URL } from '@/shared/labResearch';
import { criticModelFor } from '@/shared/llm/config';
import { requireAutoResearchConsent } from '@/shared/llm/consent';
import { useLlm } from '@/shared/llm/LlmProvider';
import { budgetFor } from '@/shared/llm/runDefaults';
import { createScholarClient } from '@/shared/scholar/client';
import { getScholarEmail } from '@/shared/scholar/settings';
import { AutoResearchConflictError } from '@/shared/storage/autoresearch';
import { useRepositories } from '@/shared/storage/StorageProvider';

const now = () => new Date().toISOString();
type Task = { controller: AbortController; stop: boolean };

export function useAutoResearch(project: ExtractionProject, bank: BankDoc | null, initialRunId?: string) {
  const repo = useRepositories();
  const { user, getIdToken } = useAuth();
  const llm = useLlm();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [runId, setRunId] = useState(initialRunId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const operation = useRef(false);
  const task = useRef<Task | null>(null);
  const run =
    runs?.find((item) => item.id === runId) ?? runs?.find((item) => item.status !== 'ended') ?? runs?.[0];
  const criticModel = criticModelFor(llm.config);
  useEffect(() => {
    let active = true;
    void repo.autoresearch
      .list(project.id)
      .then((records) => {
        if (active) setRuns(records);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'STAGE_ERROR');
      });
    return () => {
      active = false;
      task.current?.controller.abort();
    };
  }, [project.id, repo, reload]);

  const save = async (value: Run) => {
    const saved = await repo.autoresearch.save(value);
    setRuns((items) => items?.map((item) => (item.id === saved.id ? saved : item)) ?? [saved]);
    return saved;
  };
  const perform = async (work: () => Promise<void>) => {
    if (operation.current) return false;
    operation.current = true;
    setError('');
    setBusy(true);
    try {
      await work();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'STAGE_ERROR');
      if (cause instanceof AutoResearchConflictError) {
        const records = await repo.autoresearch.list(project.id).catch(() => null);
        if (records) setRuns(records);
      }
      return false;
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const create = () =>
    perform(async () => {
      const created = await repo.autoresearch.create(project.id, budgetFor((STAGES.length - 1) * 3 - 1));
      setRuns((items) => [created, ...(items ?? [])]);
      setRunId(created.id);
    });
  const change = (fn: (run: Run, at: string) => Run | Promise<Run>) =>
    perform(async () => {
      if (!run) return;
      await save(await fn(run, now()));
    });
  const start = (stage: Stage) =>
    perform(async () => {
      if (!run) return;
      const active: Task = { controller: new AbortController(), stop: false };
      task.current = active;
      const signal = active.controller.signal;
      try {
        const consent = await llm.ensureConsent('autoresearch');
        if (!consent || signal.aborted) return;
        const requireConsent = () => requireAutoResearchConsent(llm.config);
        let latest = run;
        const tools = projectTools({
          project,
          repo,
          bank,
          signal,
          requireConsent,
          getLabToken: user ? getIdToken : undefined,
          now,
          getRun: () => latest,
          scholar: createScholarClient({ email: getScholarEmail() }),
          lab:
            user && LAB_RESEARCH_URL
              ? createLabResearchClient({ baseUrl: LAB_RESEARCH_URL, getToken: getIdToken })
              : null,
        });
        await runStage(run, stage, {
          ...tools,
          now,
          signal,
          requireConsent,
          bank: await repo.researchDesigns.getBank(project.id),
          researchDesign: stage === 'S12' ? await repo.researchDesigns.get(project.id) : undefined,
          lead: { model: llm.config.model, client: llm.client },
          critic: { model: criticModel, client: llm.criticClient },
          save: async (next) => {
            latest = await save(next);
            return latest;
          },
          screen: (options) => defaultScreen({ ...options, client: llm.client, config: llm.config, signal }),
        });
        if (active.stop && latest.status !== 'ended') await save(endRun(latest, 'cancelled', now()));
      } finally {
        task.current = null;
      }
    });
  return {
    run,
    runs,
    selectRun: setRunId,
    busy,
    error,
    create,
    change,
    start,
    connectLock: (version: number) =>
      change(async (run, at) => {
        const record = await repo.researchDesigns.get(project.id);
        if (!record) throw new Error('Frozen plan not found');
        return recordPlanLock(run, record, version, at);
      }),
    importResults: (raw: string, format: 'json' | 'csv') =>
      change(async (run) => {
        const record = await repo.researchDesigns.get(project.id);
        if (!record) throw new Error('Frozen plan not found');
        return importResults(run, record, raw, format);
      }),
    edit: (stage: Stage, value: unknown, note: string) =>
      change((run, at) =>
        editArtifact(run, stage, value, modelsFor(stage, llm.config.model, criticModel), at, note),
      ),
    usingSharedModel: criticModel === llm.config.model,
    retryLoad: () => {
      setError('');
      setReload((count) => count + 1);
    },
    stop: () => {
      const active = task.current;
      if (!active) return change((record, at) => endRun(record, 'cancelled', at));
      active.stop = true;
      active.controller.abort();
    },
  };
}
