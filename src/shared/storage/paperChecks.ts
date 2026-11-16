import {
  PaperChecksRecordSchema,
  AuditEventSchema,
  type PaperChecksRecord,
  type CheckDecision,
} from '@/core/schemas';
import { validateLocations } from '@/core/paperChecks';
import { reconcileCheckDecisions } from '@/core/paperChecks/reconcile';
import type { StorageDeps } from './storageShared';
import type { createPapersRepository } from './papers';
import type { ParagraphDb } from './db';
export function createPaperChecksRepository(
  db: ParagraphDb,
  deps: StorageDeps,
  papers: ReturnType<typeof createPapersRepository>,
) {
  const { now, makeAudit } = deps;
  const paperChecks = {
    async get(paperId: string) {
      const value = await db.paperChecks.get(paperId);
      return value ? PaperChecksRecordSchema.parse(value) : undefined;
    },
    async save(input: PaperChecksRecord) {
      return db.transaction('rw', db.papers, db.paperChecks, async () => {
        const parsed = PaperChecksRecordSchema.parse(input);
        const paper = await papers.get(parsed.paperId);
        if (!paper) throw new Error('Paper not found');
        const current = await paperChecks.get(parsed.paperId);
        const reconciled = current ? reconcileCheckDecisions(paper, current, parsed.report) : null;
        const decisions = new Map(
          parsed.decisions
            .filter(
              (d) => !current?.decisions.some((old) => old.findingId === d.findingId && old.at === d.at),
            )
            .map((d) => [d.findingId, d]),
        );
        for (const decision of reconciled?.decisions ?? []) {
          const incoming = decisions.get(decision.findingId);
          if (!incoming || incoming.at < decision.at) decisions.set(decision.findingId, decision);
        }
        let dropped = 0;
        const checks = parsed.report.checks.map((check) => {
          const validated = validateLocations(paper, check.findings);
          dropped += validated.dropped;
          return { ...check, findings: validated.findings };
        });
        const value = PaperChecksRecordSchema.parse({
          ...parsed,
          report: { ...parsed.report, checks, droppedLocations: parsed.report.droppedLocations + dropped },
          decisions: [...decisions.values()],
          orphanedDecisions: reconciled?.orphanedDecisions ?? parsed.orphanedDecisions,
        });
        await db.paperChecks.put(value);
        return value;
      });
    },
    async review(
      paperId: string,
      findingId: string,
      status: CheckDecision['status'] | 'candidate',
      note = '',
    ) {
      return db.transaction('rw', db.paperChecks, db.auditEvents, async () => {
        const current = await paperChecks.get(paperId);
        if (!current?.report.checks.some((check) => check.findings.some((f) => f.id === findingId)))
          throw new Error('Check finding not found');
        const before = current.decisions.find((d) => d.findingId === findingId);
        const lastAudit = await db.auditEvents.orderBy('at').last();
        const at = new Date(
          Math.max(
            Date.parse(now()),
            Date.parse(lastAudit?.at ?? '1970-01-01T00:00:00.000Z') + 1,
            Date.parse(current.report.generatedAt) + 1,
            Date.parse(current.reviewedAt ?? current.report.generatedAt) + 1,
            ...current.decisions.map((d) => Date.parse(d.at) + 1),
          ),
        ).toISOString();
        const decisions = current.decisions.filter((d) => d.findingId !== findingId);
        if (status !== 'candidate') decisions.push({ findingId, status, note, at });
        const value = PaperChecksRecordSchema.parse({ ...current, decisions, reviewedAt: at });
        await db.paperChecks.put(value);
        await db.auditEvents.add(
          AuditEventSchema.parse({
            ...makeAudit(paperId, 'review_check', 'human'),
            issueId: findingId,
            at,
            before: before ?? null,
            after: status === 'candidate' ? null : decisions[decisions.length - 1],
            note,
          }),
        );
        return value;
      });
    },
  };
  return paperChecks;
}
