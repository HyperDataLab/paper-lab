import {
  AuditEventSchema,
  MeasurementDecisionSchema,
  MeasurementRunSchema,
  MeasurementsRecordSchema,
  type AuditEvent,
  type MeasurementDecision,
  type MeasurementPending,
  type MeasurementRun,
  type MeasurementsRecord,
} from '@/core/schemas';
import type { DocReader, DocStore } from './docStore';
import { appendAudit, requirePaper } from './storageShared';

export function createMeasurementsRepository(
  store: DocStore,
  now: () => string,
  makeAudit: (id: string, action: AuditEvent['action'], actor: AuditEvent['actor']) => AuditEvent,
) {
  async function read(reader: DocReader, paperId: string) {
    const row = await reader.get('measurements', paperId);
    return row ? MeasurementsRecordSchema.parse(row.doc) : undefined;
  }
  const empty = (paperId: string): MeasurementsRecord => ({
    schemaVersion: 1,
    paperId,
    updatedAt: now(),
    runs: [],
    decisions: [],
    pending: null,
  });
  return {
    get: (paperId: string) => read(store, paperId),
    /** Progress of an unfinished analysis. */
    async savePending(paperId: string, pending: MeasurementPending | null) {
      return store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        const value = MeasurementsRecordSchema.parse({
          ...((await read(tx, paperId)) ?? empty(paperId)),
          updatedAt: now(),
          pending,
        });
        await tx.put('measurements', paperId, value);
        return value;
      });
    },
    async saveRun(paperId: string, input: MeasurementRun) {
      const run = MeasurementRunSchema.parse(input);
      if (run.profile.paper_id !== paperId) throw new Error('Profile does not belong to this paper');
      return store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        const previous = (await read(tx, paperId)) ?? empty(paperId);
        const at = now();
        const value = MeasurementsRecordSchema.parse({
          ...previous,
          updatedAt: at,
          pending: null,
          runs: [...previous.runs.filter((item) => item.id !== run.id), run],
        });
        await tx.put('measurements', paperId, value);
        await appendAudit(
          tx,
          AuditEventSchema.parse({
            ...makeAudit(paperId, 'run_measurement', 'model'),
            at,
            after: { runId: run.id },
          }),
        );
        return value;
      });
    },
    /** Every decision is appended; the AI original in the run is never rewritten (AC-07). */
    async decide(paperId: string, input: Omit<MeasurementDecision, 'timestamp' | 'reviewer'>) {
      return store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        const previous = await read(tx, paperId);
        if (!previous?.runs.some((run) => run.id === input.run_id))
          throw new Error('Measurement run not found');
        const at = now();
        const decision = MeasurementDecisionSchema.parse({ ...input, reviewer: 'local', timestamp: at });
        const value = MeasurementsRecordSchema.parse({
          ...previous,
          updatedAt: at,
          decisions: [...previous.decisions, decision],
        });
        await tx.put('measurements', paperId, value);
        await appendAudit(
          tx,
          AuditEventSchema.parse({
            ...makeAudit(paperId, 'review_measurement', 'human'),
            at,
            issueId: decision.item_id,
            before: { field: decision.field, value: decision.previous_value },
            after: { decision: decision.decision, value: decision.new_value },
          }),
        );
        return value;
      });
    },
  };
}
