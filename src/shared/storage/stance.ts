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
import type { ParagraphDb } from './db';

export function createStanceRepository(
  db: ParagraphDb,
  now: () => string,
  makeAudit: (id: string, action: AuditEvent['action'], actor: AuditEvent['actor']) => AuditEvent,
) {
  async function get(paperId: string) {
    const row = await db.stance.get(paperId);
    return row ? StanceRecordSchema.parse(row) : undefined;
  }
  const empty = (paperId: string): StanceRecord => ({
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
    async savePending(paperId: string, pending: StancePending | null) {
      return db.transaction('rw', [db.papers, db.stance], async () => {
        await requirePaper(paperId);
        const value = StanceRecordSchema.parse({
          ...((await get(paperId)) ?? empty(paperId)),
          updatedAt: now(),
          pending,
        });
        await db.stance.put(value);
        return value;
      });
    },
    async saveRun(paperId: string, input: StanceRun, pending: StancePending | null = null) {
      const run = StanceRunSchema.parse(input);
      return db.transaction('rw', [db.papers, db.stance, db.auditEvents], async () => {
        await requirePaper(paperId);
        const previous = (await get(paperId)) ?? empty(paperId);
        const at = now();
        const value = StanceRecordSchema.parse({
          ...previous,
          updatedAt: at,
          pending,
          runs: [...previous.runs, run],
        });
        await db.stance.put(value);
        await db.auditEvents.add(
          AuditEventSchema.parse({
            ...makeAudit(paperId, 'run_stance', 'model'),
            at,
            after: { runId: run.id },
          }),
        );
        return value;
      });
    },
    async decide(paperId: string, input: Omit<StanceDecision, 'at'>) {
      return db.transaction('rw', [db.papers, db.stance, db.auditEvents], async () => {
        await requirePaper(paperId);
        const previous = await get(paperId);
        if (!previous?.runs.some((run) => run.id === input.run_id)) throw new Error('Stance run not found');
        const at = now();
        const decision = StanceDecisionSchema.parse({ ...input, at });
        const value = StanceRecordSchema.parse({
          ...previous,
          updatedAt: at,
          decisions: [...previous.decisions, decision],
        });
        await db.stance.put(value);
        await db.auditEvents.add(
          AuditEventSchema.parse({
            ...makeAudit(paperId, 'review_stance', 'human'),
            at,
            issueId: decision.annotation_id,
            after: { decision: decision.decision },
          }),
        );
        return value;
      });
    },
  };
}
