import {
  AuditEventSchema,
  StanceDecisionSchema,
  StanceRecordSchema,
  StanceRunSchema,
  type AuditEvent,
  type StanceDecision,
  type StancePending,
  type StanceRecord,
  type StanceRun,
} from '@/core/schemas';
import { carryDecisions, mergeStanceRuns } from '@/core/sectionRun';
import type { DocReader, DocStore } from './docStore';
import { appendAudit, requirePaper } from './storageShared';

export function createStanceRepository(
  store: DocStore,
  now: () => string,
  makeAudit: (id: string, action: AuditEvent['action'], actor: AuditEvent['actor']) => AuditEvent,
) {
  async function read(reader: DocReader, paperId: string) {
    const row = await reader.get('stance', paperId);
    return row ? StanceRecordSchema.parse(row.doc) : undefined;
  }
  const empty = (paperId: string): StanceRecord => ({
    schemaVersion: 1,
    paperId,
    updatedAt: now(),
    runs: [],
    decisions: [],
    pending: null,
  });
  return {
    get: (paperId: string) => read(store, paperId),
    async savePending(paperId: string, pending: StancePending | null) {
      return store.unitOfWork(
        async (tx) => {
          await requirePaper(tx, paperId);
          const value = StanceRecordSchema.parse({
            ...((await read(tx, paperId)) ?? empty(paperId)),
            updatedAt: now(),
            pending,
          });
          await tx.put('stance', paperId, value);
          return value;
        },
        ['papers', 'stance'],
      );
    },
    async saveRun(paperId: string, input: StanceRun, pending: StancePending | null = null) {
      const run = StanceRunSchema.parse(input);
      return store.unitOfWork(
        async (tx) => {
          await requirePaper(tx, paperId);
          const previous = (await read(tx, paperId)) ?? empty(paperId);
          const at = now();
          const value = StanceRecordSchema.parse({
            ...previous,
            updatedAt: at,
            pending,
            runs: [...previous.runs, run],
          });
          await tx.put('stance', paperId, value);
          await appendAudit(
            tx,
            AuditEventSchema.parse({
              ...makeAudit(paperId, 'run_stance', 'model'),
              at,
              after: { runId: run.id },
            }),
          );
          return value;
        },
        ['papers', 'stance'],
      );
    },
    /** Merges a run over a few sections into the latest stance run; see core/sectionRun for the rules. */
    async saveSectionRun(paperId: string, input: StanceRun, sectionIds: string[]) {
      const next = StanceRunSchema.parse(input);
      return store.unitOfWork(
        async (tx) => {
          await requirePaper(tx, paperId);
          const previous = (await read(tx, paperId)) ?? empty(paperId);
          const latest = previous.runs.at(-1);
          const at = now();
          const merged = latest
            ? mergeStanceRuns(latest, next, sectionIds, { id: next.id, createdAt: next.createdAt })
            : { run: next, keptIds: [] };
          const value = StanceRecordSchema.parse({
            ...previous,
            updatedAt: at,
            runs: [...previous.runs, merged.run],
            decisions: [
              ...previous.decisions,
              ...(latest
                ? carryDecisions(
                    previous.decisions,
                    latest.id,
                    merged.run.id,
                    merged.keptIds,
                    (item) => item.annotation_id,
                  )
                : []),
            ],
          });
          await tx.put('stance', paperId, value);
          await appendAudit(
            tx,
            AuditEventSchema.parse({
              ...makeAudit(paperId, 'run_stance', 'model'),
              at,
              after: { runId: merged.run.id, mergedFrom: latest?.id ?? null, sectionIds },
            }),
          );
          return value;
        },
        ['papers', 'stance'],
      );
    },
    async decide(paperId: string, input: Omit<StanceDecision, 'at'>) {
      return store.unitOfWork(
        async (tx) => {
          await requirePaper(tx, paperId);
          const previous = await read(tx, paperId);
          if (!previous?.runs.some((run) => run.id === input.run_id)) throw new Error('Stance run not found');
          const at = now();
          const decision = StanceDecisionSchema.parse({ ...input, at });
          const value = StanceRecordSchema.parse({
            ...previous,
            updatedAt: at,
            decisions: [...previous.decisions, decision],
          });
          await tx.put('stance', paperId, value);
          await appendAudit(
            tx,
            AuditEventSchema.parse({
              ...makeAudit(paperId, 'review_stance', 'human'),
              at,
              issueId: decision.annotation_id,
              after: { decision: decision.decision },
            }),
          );
          return value;
        },
        ['papers', 'stance'],
      );
    },
  };
}
