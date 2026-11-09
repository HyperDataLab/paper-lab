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
import type { ParagraphDb } from './db';

export function createMeasurementsRepository(
  db: ParagraphDb,
  now: () => string,
  makeAudit: (id: string, action: AuditEvent['action'], actor: AuditEvent['actor']) => AuditEvent,
) {
  async function get(paperId: string) {
    const row = await db.measurements.get(paperId);
    return row ? MeasurementsRecordSchema.parse(row) : undefined;
  }
  const empty = (paperId: string): MeasurementsRecord => ({
    schemaVersion: 1,
    paperId,
    updatedAt: now(),
    runs: [],
    decisions: [],
    pending: null,
  });
  async function requirePaper(paperId: string) {
    if (!(await db.papers.get(paperId))) throw new Error('Paper not found');
  }
  return {
    get,
    /** Progress of an unfinished analysis. */
    async savePending(paperId: string, pending: MeasurementPending | null) {
      return db.transaction('rw', [db.papers, db.measurements], async () => {
        await requirePaper(paperId);
        const value = MeasurementsRecordSchema.parse({
          ...((await get(paperId)) ?? empty(paperId)),
          updatedAt: now(),
          pending,
        });
        await db.measurements.put(value);
        return value;
      });
    },
    async saveRun(paperId: string, input: MeasurementRun) {
      const run = MeasurementRunSchema.parse(input);
      if (run.profile.paper_id !== paperId) throw new Error('Profile does not belong to this paper');
      return db.transaction('rw', [db.papers, db.measurements, db.auditEvents], async () => {
        await requirePaper(paperId);
        const previous = (await get(paperId)) ?? empty(paperId);
        const at = now();
        const value = MeasurementsRecordSchema.parse({
          ...previous,
          updatedAt: at,
          pending: null,
          runs: [...previous.runs.filter((item) => item.id !== run.id), run],
        });
        await db.measurements.put(value);
        await db.auditEvents.add(
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
      return db.transaction('rw', [db.papers, db.measurements, db.auditEvents], async () => {
        await requirePaper(paperId);
        const previous = await get(paperId);
        if (!previous?.runs.some((run) => run.id === input.run_id))
          throw new Error('Measurement run not found');
        const at = now();
        const decision = MeasurementDecisionSchema.parse({ ...input, reviewer: 'local', timestamp: at });
        const value = MeasurementsRecordSchema.parse({
          ...previous,
          updatedAt: at,
          decisions: [...previous.decisions, decision],
        });
        await db.measurements.put(value);
        await db.auditEvents.add(
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
