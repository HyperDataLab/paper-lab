import {
  ResearchDesignSchema,
  emptyResearchDesign,
  type ResearchDesign,
} from '@/core/schemas/researchDesign';
import { bankDocSchema } from '@/core/researchDesign/bank/snapshot';
import { snapshotRelease } from '@/core/researchDesign/bank/release';
import { toBankDoc } from '@/core/researchDesign/bank/readSnapshot';
import { freezeGate, nextVersion } from '@/core/researchDesign/draft/freezeGate';
import type { PapersDoc } from '@/core/researchDesign/papers';
import { checkLockPlan } from '@/core/autoresearch/lock';
import { runSchema, type Run } from '@/core/autoresearch/record';
import type { DocReader, DocStore, DocTx } from './docStore';
import { ResearchDesignConflictError, StorageConflictError } from './errors';
import type { FreezeForRun } from './types';

export type { FreezeForRun } from './types';
export { ResearchDesignConflictError } from './errors';

async function readDesign(reader: DocReader, projectId: string) {
  const row = await reader.get('researchDesigns', projectId);
  return row ? ResearchDesignSchema.parse(row.doc) : undefined;
}

export function createResearchDesignRepository(store: DocStore, now: () => string) {
  const get = (projectId: string) => readDesign(store, projectId);
  const change = async (
    projectId: string,
    collections: readonly string[],
    fn: (tx: DocTx) => Promise<ResearchDesign>,
  ) => {
    try {
      return await store.unitOfWork(fn, collections);
    } catch (error) {
      if (!(error instanceof StorageConflictError) || error instanceof ResearchDesignConflictError)
        throw error;
      throw new ResearchDesignConflictError(error.message, projectId);
    }
  };
  return {
    get,
    async save(input: ResearchDesign, expectedVersion: number) {
      const parsed = ResearchDesignSchema.parse(input);
      return change(parsed.projectId, ['extractionProjects', 'researchDesigns'], async (tx) => {
        if (!(await tx.get('extractionProjects', parsed.projectId))) throw new Error('Project not found');
        const current = (await readDesign(tx, parsed.projectId)) ?? emptyResearchDesign(parsed.projectId);
        if (current.version !== expectedVersion || parsed.version !== expectedVersion)
          throw new ResearchDesignConflictError('Research design changed', parsed.projectId, current.version);
        if (JSON.stringify(parsed.frozenPlans) !== JSON.stringify(current.frozenPlans))
          throw new ResearchDesignConflictError(
            'Frozen plans are immutable',
            parsed.projectId,
            current.version,
          );
        if (parsed.bankRelease !== current.bankRelease) throw new Error('Use importBank to change the bank');
        const latest = current.frozenPlans.at(-1);
        const runId = latest?.context?.autoresearch?.runId;
        const changed = JSON.stringify(parsed.draft) !== JSON.stringify(current.draft);
        const planDeviation =
          current.planDeviation ??
          (latest && runId && changed
            ? { runId, planVersion: latest.planVersion, changedAt: now() }
            : undefined);
        const value = ResearchDesignSchema.parse({ ...parsed, planDeviation, version: current.version + 1 });
        await tx.put('researchDesigns', value.projectId, value);
        return value;
      });
    },
    async freeze(
      projectId: string,
      expectedVersion: number,
      version: number,
      who: string,
      deviation: string | null,
      papers: PapersDoc,
      appVersion: string,
      lock?: FreezeForRun,
    ) {
      return change(projectId, ['extractionProjects', 'researchDesigns', 'autoresearchRuns'], async (tx) => {
        const projectRow = await tx.get('extractionProjects', projectId);
        if (!projectRow) throw new Error('Project not found');
        const project = projectRow.doc as { title: string };
        const current = (await readDesign(tx, projectId)) ?? emptyResearchDesign(projectId);
        if (
          current.version !== expectedVersion ||
          version !== nextVersion(current.frozenPlans.map((p) => p.planVersion)) ||
          (lock && lock.designVersion !== current.version)
        )
          throw new ResearchDesignConflictError(
            'Research design or plan version changed',
            projectId,
            current.version,
          );
        const previous = current.frozenPlans.at(-1) ?? null;
        if ((current.draft.autoresearchDesign || previous?.context?.autoresearch) && !lock)
          throw new Error('Use the pinned AutoResearch lock action');
        const gate = freezeGate(
          current.draft,
          {
            planId: projectId,
            planVersion: version,
            title: current.draft.planTitle || project.title,
            frozenAt: now(),
            frozenBy: who,
            deviation,
            appVersion,
          },
          papers,
          previous,
        );
        if (gate.state !== 'plan' || gate.blocked || (gate.unchanged && !current.planDeviation))
          throw new Error('Plan cannot be frozen');
        if (lock) {
          const stored = (await tx.get('autoresearchRuns', lock.runId))?.doc as Run | undefined;
          if (!stored || stored.revision !== lock.revision)
            throw new ResearchDesignConflictError('AutoResearch run changed', projectId, current.version);
          const run = runSchema.parse(stored);
          if (
            run.status === 'running' ||
            run.pipeline.some((row) => row.state === 'working' && row.stage !== 'S12') ||
            (run.status === 'ended' && (run.endReason === 'failed' || run.endReason === 'cancelled'))
          )
            throw new Error('AutoResearch run cannot be locked');
          if (run.status === 'ended') {
            const projectRuns = await tx.query('autoresearchRuns', {
              where: { projectId },
              select: 'summary',
            });
            if (projectRuns.some((item) => item.id !== run.id && (item.doc as Run).status !== 'ended'))
              throw new ResearchDesignConflictError(
                'Another AutoResearch run is active',
                projectId,
                current.version,
              );
          }
          checkLockPlan(run, gate.plan);
        }
        const value = ResearchDesignSchema.parse({
          ...current,
          version: current.version + 1,
          frozenPlans: [...current.frozenPlans, gate.plan],
          planDeviation: undefined,
        });
        await tx.put('researchDesigns', projectId, value);
        return value;
      });
    },
    async listFrozenVersions(projectId: string) {
      return (await get(projectId))?.frozenPlans ?? [];
    },
    async getBank(projectId: string) {
      const row = await store.get('researchDesignBanks', projectId);
      return row ? bankDocSchema.parse((row.doc as { bank: unknown }).bank) : null;
    },
    async importBank(projectId: string, expectedVersion: number, bytes: ArrayBuffer, who: string) {
      const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
      const result = await snapshotRelease(data, bytes);
      if (!result.ok) throw new Error(`Invalid bank snapshot: ${result.reason}`);
      const bank = toBankDoc(result.file, result.release, who, now());
      return change(
        projectId,
        ['extractionProjects', 'researchDesigns', 'researchDesignBanks'],
        async (tx) => {
          if (!(await tx.get('extractionProjects', projectId))) throw new Error('Project not found');
          const current = (await readDesign(tx, projectId)) ?? emptyResearchDesign(projectId);
          if (current.version !== expectedVersion)
            throw new ResearchDesignConflictError('Research design changed', projectId, current.version);
          const value = ResearchDesignSchema.parse({
            ...current,
            version: current.version + 1,
            bankRelease: bank.release,
          });
          await tx.put('researchDesignBanks', projectId, {
            projectId,
            bank: bankDocSchema.parse(bank),
            bytes: Array.from(new Uint8Array(bytes)),
          });
          await tx.put('researchDesigns', projectId, value);
          return value;
        },
      );
    },
  };
}
