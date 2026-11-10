import {
  ArgumentRunSchema,
  AuditEventSchema,
  InsightDecisionSchema,
  PaperInsightsRecordSchema,
  RhetoricRunSchema,
  type ArgumentPending,
  type ArgumentRun,
  type AuditEvent,
  type InsightDecision,
  type PaperInsightsRecord,
  type RhetoricPending,
  type RhetoricRun,
} from '@/core/schemas';
import type { ParagraphDb } from './db';

export function createPaperInsightsRepository(
  db: ParagraphDb,
  now: () => string,
  makeAudit: (id: string, action: AuditEvent['action'], actor: AuditEvent['actor']) => AuditEvent,
) {
  async function get(paperId: string) {
    const row = await db.paperInsights.get(paperId);
    return row ? PaperInsightsRecordSchema.parse(row) : undefined;
  }
  const empty = (paperId: string): PaperInsightsRecord => ({
    schemaVersion: 1,
    paperId,
    updatedAt: now(),
    rhetoricRuns: [],
    rhetoricPending: null,
    argumentRuns: [],
    argumentPending: null,
    decisions: [],
  });
  async function requirePaper(paperId: string) {
    if (!(await db.papers.get(paperId))) throw new Error('Paper not found');
  }
  async function audit(
    paperId: string,
    action: AuditEvent['action'],
    at: string,
    after: unknown,
    issueId?: string,
  ) {
    await db.auditEvents.add(
      AuditEventSchema.parse({
        ...makeAudit(paperId, action, action.startsWith('run_') ? 'model' : 'human'),
        at,
        ...(issueId ? { issueId } : {}),
        after,
      }),
    );
  }
  return {
    get,
    async saveRhetoricPending(paperId: string, pending: RhetoricPending | null) {
      return db.transaction('rw', [db.papers, db.paperInsights], async () => {
        await requirePaper(paperId);
        const value = PaperInsightsRecordSchema.parse({
          ...((await get(paperId)) ?? empty(paperId)),
          updatedAt: now(),
          rhetoricPending: pending,
        });
        await db.paperInsights.put(value);
        return value;
      });
    },
    async saveRhetoricRun(paperId: string, input: RhetoricRun, pending: RhetoricPending | null = null) {
      const run = RhetoricRunSchema.parse(input);
      return db.transaction('rw', [db.papers, db.paperInsights, db.auditEvents], async () => {
        await requirePaper(paperId);
        const previous = (await get(paperId)) ?? empty(paperId);
        const at = now();
        const value = PaperInsightsRecordSchema.parse({
          ...previous,
          updatedAt: at,
          rhetoricPending: pending,
          rhetoricRuns: [...previous.rhetoricRuns, run],
        });
        await db.paperInsights.put(value);
        await audit(paperId, 'run_rhetoric', at, { runId: run.id });
        return value;
      });
    },
    async saveArgumentPending(paperId: string, pending: ArgumentPending | null) {
      return db.transaction('rw', [db.papers, db.paperInsights], async () => {
        await requirePaper(paperId);
        const value = PaperInsightsRecordSchema.parse({
          ...((await get(paperId)) ?? empty(paperId)),
          updatedAt: now(),
          argumentPending: pending,
        });
        await db.paperInsights.put(value);
        return value;
      });
    },
    async saveArgumentRun(paperId: string, input: ArgumentRun, pending: ArgumentPending | null = null) {
      const run = ArgumentRunSchema.parse(input);
      return db.transaction('rw', [db.papers, db.paperInsights, db.auditEvents], async () => {
        await requirePaper(paperId);
        const previous = (await get(paperId)) ?? empty(paperId);
        const at = now();
        const value = PaperInsightsRecordSchema.parse({
          ...previous,
          updatedAt: at,
          argumentPending: pending,
          argumentRuns: [...previous.argumentRuns, run],
        });
        await db.paperInsights.put(value);
        await audit(paperId, 'run_argument', at, { runId: run.id });
        return value;
      });
    },
    async decide(paperId: string, input: Omit<InsightDecision, 'at'>) {
      return db.transaction('rw', [db.papers, db.paperInsights, db.auditEvents], async () => {
        await requirePaper(paperId);
        const previous = await get(paperId);
        if (!previous) throw new Error('Run not found');
        const isArgument = previous.argumentRuns.some((run) => run.id === input.run_id);
        if (!isArgument && !previous.rhetoricRuns.some((run) => run.id === input.run_id))
          throw new Error('Run not found');
        const at = now();
        const decision = InsightDecisionSchema.parse({ ...input, at });
        const value = PaperInsightsRecordSchema.parse({
          ...previous,
          updatedAt: at,
          decisions: [...previous.decisions, decision],
        });
        await db.paperInsights.put(value);
        await audit(
          paperId,
          isArgument ? 'review_argument' : 'review_rhetoric',
          at,
          { decision: decision.decision },
          decision.item_id,
        );
        return value;
      });
    },
  };
}
