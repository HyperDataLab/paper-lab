import {
  AuditEventSchema,
  MeasurementDecisionSchema,
  MeasurementRunSchema,
  MeasurementPendingSchema,
  MeasurementsRecordSchema,
  type AuditEvent,
  type MeasurementDecision,
  type MeasurementPending,
  type MeasurementRun,
  type MeasurementsRecord,
} from '@/core/schemas';
import type { DocReader, DocStore } from './docStore';
import { appendAudit, requirePaper } from './storageShared';
import {
  clearMeasurementPending,
  createMeasurementCheckpoints,
  listMeasurementPending,
  readMeasurementPending,
} from './measurementCheckpoints';
import { CheckpointChangedError, checkpointParts, type CheckpointStore } from './paperCheckpoints';

export const measurementsCollection = 'measurements';
const collections = ['papers', 'measurements', checkpointParts];

export function createMeasurementsRepository(
  store: DocStore,
  now: () => string,
  makeAudit: (id: string, action: AuditEvent['action'], actor: AuditEvent['actor']) => AuditEvent,
  checkpointStore: CheckpointStore,
) {
  const checkpoints = createMeasurementCheckpoints(store, now, checkpointStore);
  async function readRecord(reader: DocReader, paperId: string) {
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
  async function read(paperId: string) {
    const [record, checkpoint] = await Promise.all([
      readRecord(store, paperId),
      readMeasurementPending(store, paperId),
    ]);
    return merge(paperId, record, checkpoint);
  }
  function merge(
    paperId: string,
    record?: MeasurementsRecord,
    checkpoint?: { pending: MeasurementPending; updatedAt: string },
  ) {
    if (!checkpoint) return record;
    return {
      ...(record ?? empty(paperId)),
      pending: checkpoint.pending,
      updatedAt: record && record.updatedAt > checkpoint.updatedAt ? record.updatedAt : checkpoint.updatedAt,
    };
  }
  return {
    checkpoints,
    async get(paperId: string) {
      try {
        return await read(paperId);
      } catch (error) {
        if (!(error instanceof CheckpointChangedError)) throw error;
        return read(paperId);
      }
    },
    async list() {
      const [records, checkpoints] = await Promise.all([
        store.query(measurementsCollection),
        listMeasurementPending(store),
      ]);
      const results = new Map(records.map(({ id, doc }) => [id, MeasurementsRecordSchema.parse(doc)]));
      for (const checkpoint of checkpoints) {
        const { paperId } = checkpoint;
        const record = merge(paperId, results.get(paperId), checkpoint);
        if (record) results.set(paperId, record);
      }
      return [...results.values()];
    },
    /** Progress of an unfinished analysis. */
    async savePending(paperId: string, pending: MeasurementPending | null) {
      if (pending) {
        await checkpoints.flush(paperId);
        await checkpoints.save(paperId, MeasurementPendingSchema.parse(pending));
        return (await read(paperId)) ?? empty(paperId);
      }
      await checkpoints.flush(paperId);
      const saved = await store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        await clearMeasurementPending(tx, paperId);
        const value = {
          ...((await readRecord(tx, paperId)) ?? empty(paperId)),
          updatedAt: now(),
          pending: null,
        };
        await tx.put('measurements', paperId, value);
        return value;
      }, collections);
      checkpoints.reset(paperId);
      return saved;
    },
    async saveRun(paperId: string, input: MeasurementRun) {
      const run = MeasurementRunSchema.parse(input);
      if (run.profile.paper_id !== paperId) throw new Error('Profile does not belong to this paper');
      await checkpoints.flush(paperId);
      const saved = await store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        const previous = (await readRecord(tx, paperId)) ?? empty(paperId);
        const at = now();
        const value = MeasurementsRecordSchema.parse({
          ...previous,
          updatedAt: at,
          pending: null,
          runs: [...previous.runs.filter((item) => item.id !== run.id), run],
        });
        await clearMeasurementPending(tx, paperId);
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
      }, collections);
      checkpoints.reset(paperId);
      return saved;
    },
    /** Every decision is appended; the AI original in the run is never rewritten (AC-07). */
    async decide(paperId: string, input: Omit<MeasurementDecision, 'timestamp' | 'reviewer'>) {
      const saved = await store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        const previous = await readRecord(tx, paperId);
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
      }, collections);
      const pending = await readMeasurementPending(store, paperId);
      return pending ? { ...saved, pending: pending.pending } : saved;
    },
  };
}
