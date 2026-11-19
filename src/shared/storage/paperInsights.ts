import {
  ArgumentRunSchema,
  AuditEventSchema,
  InsightDecisionSchema,
  PaperInsightsRecordSchema,
  RhetoricRunSchema,
  SnapshotRunSchema,
  DigestRunSchema,
  ContributionRunSchema,
  type ContributionRun,
  type ContributionPending,
  type DigestRun,
  type ArgumentPending,
  type ArgumentRun,
  type AuditEvent,
  type InsightDecision,
  type PaperInsightsRecord,
  type RhetoricPending,
  type RhetoricRun,
  type SnapshotRun,
} from '@/core/schemas';
import { carryDecisions, mergeArgumentRuns, mergeRhetoricRuns } from '@/core/sectionRun';
import type { DocReader, DocStore, DocWriter } from './docStore';
import { appendAudit, requirePaper } from './storageShared';

export function createPaperInsightsRepository(
  store: DocStore,
  now: () => string,
  makeAudit: (id: string, action: AuditEvent['action'], actor: AuditEvent['actor']) => AuditEvent,
) {
  async function read(reader: DocReader, paperId: string) {
    const row = await reader.get('paperInsights', paperId);
    return row ? PaperInsightsRecordSchema.parse(row.doc) : undefined;
  }
  const empty = (paperId: string): PaperInsightsRecord => ({
    schemaVersion: 1,
    paperId,
    updatedAt: now(),
    rhetoricRuns: [],
    rhetoricPending: null,
    argumentRuns: [],
    argumentPending: null,
    snapshotRuns: [],
    digestRuns: [],
    contributionRuns: [],
    contributionPending: null,
    decisions: [],
  });
  async function audit(
    tx: DocWriter,
    paperId: string,
    action: AuditEvent['action'],
    at: string,
    after: unknown,
    issueId?: string,
  ) {
    await appendAudit(
      tx,
      AuditEventSchema.parse({
        ...makeAudit(paperId, action, action.startsWith('run_') ? 'model' : 'human'),
        at,
        ...(issueId ? { issueId } : {}),
        after,
      }),
    );
  }
  return {
    get: (paperId: string) => read(store, paperId),
    async saveContributionPending(paperId: string, pending: ContributionPending | null) {
      return store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        const value = PaperInsightsRecordSchema.parse({
          ...((await read(tx, paperId)) ?? empty(paperId)),
          updatedAt: now(),
          contributionPending: pending,
        });
        await tx.put('paperInsights', paperId, value);
        return value;
      });
    },
    async saveContributionRun(paperId: string, input: ContributionRun) {
      const run = ContributionRunSchema.parse(input);
      return store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        const previous = (await read(tx, paperId)) ?? empty(paperId);
        const value = PaperInsightsRecordSchema.parse({
          ...previous,
          updatedAt: now(),
          contributionRuns: [...previous.contributionRuns, run],
          contributionPending: null,
        });
        await tx.put('paperInsights', paperId, value);
        return value;
      });
    },
    async saveRhetoricPending(paperId: string, pending: RhetoricPending | null) {
      return store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        const value = PaperInsightsRecordSchema.parse({
          ...((await read(tx, paperId)) ?? empty(paperId)),
          updatedAt: now(),
          rhetoricPending: pending,
        });
        await tx.put('paperInsights', paperId, value);
        return value;
      });
    },
    async saveRhetoricRun(paperId: string, input: RhetoricRun, pending: RhetoricPending | null = null) {
      const run = RhetoricRunSchema.parse(input);
      return store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        const previous = (await read(tx, paperId)) ?? empty(paperId);
        const at = now();
        const value = PaperInsightsRecordSchema.parse({
          ...previous,
          updatedAt: at,
          rhetoricPending: pending,
          rhetoricRuns: [...previous.rhetoricRuns, run],
        });
        await tx.put('paperInsights', paperId, value);
        await audit(tx, paperId, 'run_rhetoric', at, { runId: run.id });
        return value;
      });
    },
    /** Merges a run over a few sections into the latest rhetoric run; see core/sectionRun for the rules. */
    async saveRhetoricSectionRun(paperId: string, input: RhetoricRun, sectionIds: string[]) {
      const next = RhetoricRunSchema.parse(input);
      return store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        const previous = (await read(tx, paperId)) ?? empty(paperId);
        const latest = previous.rhetoricRuns.at(-1);
        const at = now();
        const merged = latest
          ? mergeRhetoricRuns(latest, next, sectionIds, { id: next.id, createdAt: next.createdAt })
          : { run: next, keptIds: [] };
        const value = PaperInsightsRecordSchema.parse({
          ...previous,
          updatedAt: at,
          rhetoricRuns: [...previous.rhetoricRuns, merged.run],
          decisions: [
            ...previous.decisions,
            ...(latest
              ? carryDecisions(
                  previous.decisions,
                  latest.id,
                  merged.run.id,
                  merged.keptIds,
                  (item) => item.item_id,
                )
              : []),
          ],
        });
        await tx.put('paperInsights', paperId, value);
        await audit(tx, paperId, 'run_rhetoric', at, {
          runId: merged.run.id,
          mergedFrom: latest?.id ?? null,
          sectionIds,
        });
        return value;
      });
    },
    /** Merges a run over a few sections into the latest argument run; see core/sectionRun for the rules. */
    async saveArgumentSectionRun(paperId: string, input: ArgumentRun, sectionIds: string[]) {
      const next = ArgumentRunSchema.parse(input);
      return store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        const previous = (await read(tx, paperId)) ?? empty(paperId);
        const latest = previous.argumentRuns.at(-1);
        const at = now();
        const merged = latest
          ? mergeArgumentRuns(latest, next, sectionIds, { id: next.id, createdAt: next.createdAt })
          : { run: next, keptIds: [] };
        const value = PaperInsightsRecordSchema.parse({
          ...previous,
          updatedAt: at,
          argumentRuns: [...previous.argumentRuns, merged.run],
          decisions: [
            ...previous.decisions,
            ...(latest
              ? carryDecisions(
                  previous.decisions,
                  latest.id,
                  merged.run.id,
                  merged.keptIds,
                  (item) => item.item_id,
                )
              : []),
          ],
        });
        await tx.put('paperInsights', paperId, value);
        await audit(tx, paperId, 'run_argument', at, {
          runId: merged.run.id,
          mergedFrom: latest?.id ?? null,
          sectionIds,
        });
        return value;
      });
    },
    async saveArgumentPending(paperId: string, pending: ArgumentPending | null) {
      return store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        const value = PaperInsightsRecordSchema.parse({
          ...((await read(tx, paperId)) ?? empty(paperId)),
          updatedAt: now(),
          argumentPending: pending,
        });
        await tx.put('paperInsights', paperId, value);
        return value;
      });
    },
    async saveArgumentRun(paperId: string, input: ArgumentRun, pending: ArgumentPending | null = null) {
      const run = ArgumentRunSchema.parse(input);
      return store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        const previous = (await read(tx, paperId)) ?? empty(paperId);
        const at = now();
        const value = PaperInsightsRecordSchema.parse({
          ...previous,
          updatedAt: at,
          argumentPending: pending,
          argumentRuns: [...previous.argumentRuns, run],
        });
        await tx.put('paperInsights', paperId, value);
        await audit(tx, paperId, 'run_argument', at, { runId: run.id });
        return value;
      });
    },
    async saveSnapshotRun(paperId: string, input: SnapshotRun) {
      const run = SnapshotRunSchema.parse(input);
      return store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        const previous = (await read(tx, paperId)) ?? empty(paperId);
        const at = now();
        const value = PaperInsightsRecordSchema.parse({
          ...previous,
          updatedAt: at,
          snapshotRuns: [...previous.snapshotRuns, run],
        });
        await tx.put('paperInsights', paperId, value);
        await audit(tx, paperId, 'run_snapshot', at, { runId: run.id });
        return value;
      });
    },
    async saveDigestRun(paperId: string, input: DigestRun) {
      const run = DigestRunSchema.parse(input);
      return store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        const previous = (await read(tx, paperId)) ?? empty(paperId);
        const at = now();
        const value = PaperInsightsRecordSchema.parse({
          ...previous,
          updatedAt: at,
          digestRuns: [...previous.digestRuns, run],
        });
        await tx.put('paperInsights', paperId, value);
        await audit(tx, paperId, 'run_digest', at, { runId: run.id });
        return value;
      });
    },
    async decide(paperId: string, input: Omit<InsightDecision, 'at'>) {
      return store.unitOfWork(async (tx) => {
        await requirePaper(tx, paperId);
        const previous = await read(tx, paperId);
        if (!previous) throw new Error('Run not found');
        const isArgument = previous.argumentRuns.some((run) => run.id === input.run_id);
        const isSnapshot = previous.snapshotRuns.some((run) => run.id === input.run_id);
        if (!isArgument && !isSnapshot && !previous.rhetoricRuns.some((run) => run.id === input.run_id))
          throw new Error('Run not found');
        const at = now();
        const decision = InsightDecisionSchema.parse({ ...input, at });
        const value = PaperInsightsRecordSchema.parse({
          ...previous,
          updatedAt: at,
          decisions: [...previous.decisions, decision],
        });
        await tx.put('paperInsights', paperId, value);
        await audit(
          tx,
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
