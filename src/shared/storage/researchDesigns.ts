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
import type { ParagraphDb } from './db';
import { checkLockPlan } from '@/core/autoresearch/lock';
import { runSchema } from '@/core/autoresearch/record';

export type FreezeForRun = { runId: string; revision: number; designVersion: number };

export class ResearchDesignConflictError extends Error {}

export function createResearchDesignRepository(db: ParagraphDb, now: () => string) {
  async function get(projectId: string) {
    const row = await db.researchDesigns.get(projectId);
    return row ? ResearchDesignSchema.parse(row) : undefined;
  }
  return {
    get,
    async save(input: ResearchDesign, expectedVersion: number) {
      const parsed = ResearchDesignSchema.parse(input);
      return db.transaction('rw', [db.extractionProjects, db.researchDesigns], async () => {
        if (!(await db.extractionProjects.get(parsed.projectId))) throw new Error('Project not found');
        const current = (await get(parsed.projectId)) ?? emptyResearchDesign(parsed.projectId);
        if (current.version !== expectedVersion || parsed.version !== expectedVersion)
          throw new ResearchDesignConflictError('Research design changed');
        if (JSON.stringify(parsed.frozenPlans) !== JSON.stringify(current.frozenPlans))
          throw new ResearchDesignConflictError('Frozen plans are immutable');
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
        await db.researchDesigns.put(value);
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
      return db.transaction(
        'rw',
        [db.extractionProjects, db.researchDesigns, db.autoresearchRuns],
        async () => {
          const project = await db.extractionProjects.get(projectId);
          if (!project) throw new Error('Project not found');
          const current = (await get(projectId)) ?? emptyResearchDesign(projectId);
          if (
            current.version !== expectedVersion ||
            version !== nextVersion(current.frozenPlans.map((p) => p.planVersion)) ||
            (lock && lock.designVersion !== current.version)
          )
            throw new ResearchDesignConflictError('Research design or plan version changed');
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
            const stored = await db.autoresearchRuns.get(lock.runId);
            if (!stored || stored.revision !== lock.revision)
              throw new ResearchDesignConflictError('AutoResearch run changed');
            const run = runSchema.parse(stored);
            if (
              run.status === 'running' ||
              run.pipeline.some((row) => row.state === 'working' && row.stage !== 'S12') ||
              (run.status === 'ended' && (run.endReason === 'failed' || run.endReason === 'cancelled'))
            )
              throw new Error('AutoResearch run cannot be locked');
            if (run.status === 'ended') {
              const projectRuns = await db.autoresearchRuns.where('projectId').equals(projectId).toArray();
              if (projectRuns.some((item) => item.id !== run.id && item.status !== 'ended'))
                throw new ResearchDesignConflictError('Another AutoResearch run is active');
            }
            checkLockPlan(run, gate.plan);
          }
          const value = ResearchDesignSchema.parse({
            ...current,
            version: current.version + 1,
            frozenPlans: [...current.frozenPlans, gate.plan],
            planDeviation: undefined,
          });
          await db.researchDesigns.put(value);
          return value;
        },
      );
    },
    async listFrozenVersions(projectId: string) {
      return (await get(projectId))?.frozenPlans ?? [];
    },
    async getBank(projectId: string) {
      const row = await db.researchDesignBanks.get(projectId);
      return row ? bankDocSchema.parse(row.bank) : null;
    },
    async importBank(projectId: string, expectedVersion: number, bytes: ArrayBuffer, who: string) {
      const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
      const result = await snapshotRelease(data, bytes);
      if (!result.ok) throw new Error(`Invalid bank snapshot: ${result.reason}`);
      const bank = toBankDoc(result.file, result.release, who, now());
      return db.transaction(
        'rw',
        [db.extractionProjects, db.researchDesigns, db.researchDesignBanks],
        async () => {
          if (!(await db.extractionProjects.get(projectId))) throw new Error('Project not found');
          const current = (await get(projectId)) ?? emptyResearchDesign(projectId);
          if (current.version !== expectedVersion)
            throw new ResearchDesignConflictError('Research design changed');
          const value = ResearchDesignSchema.parse({
            ...current,
            version: current.version + 1,
            bankRelease: bank.release,
          });
          await db.researchDesignBanks.put({
            projectId,
            bank: bankDocSchema.parse(bank),
            bytes: Array.from(new Uint8Array(bytes)),
          });
          await db.researchDesigns.put(value);
          return value;
        },
      );
    },
  };
}
