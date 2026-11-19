import {
  PaperChecksRecordSchema,
  PaperSchema,
  AuditEventSchema,
  type AuditEvent,
  type PaperChecksRecord,
  type CheckDecision,
} from '@/core/schemas';
import { validateLocations } from '@/core/paperChecks';
import { reconcileCheckDecisions } from '@/core/paperChecks/reconcile';
import { appendAudit, type StorageDeps } from './storageShared';
import type { DocReader, DocStore } from './docStore';

async function read(reader: DocReader, paperId: string) {
  const row = await reader.get('paperChecks', paperId);
  return row ? PaperChecksRecordSchema.parse(row.doc) : undefined;
}

export function createPaperChecksRepository(store: DocStore, deps: StorageDeps) {
  const { now, makeAudit } = deps;
  const paperChecks = {
    get: (paperId: string) => read(store, paperId),
    async save(input: PaperChecksRecord) {
      return store.unitOfWork(async (tx) => {
        const parsed = PaperChecksRecordSchema.parse(input);
        const paperRow = await tx.get('papers', parsed.paperId);
        if (!paperRow) throw new Error('Paper not found');
        const paper = PaperSchema.parse(paperRow.doc);
        const current = await read(tx, parsed.paperId);
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
        await tx.put('paperChecks', value.paperId, value);
        return value;
      });
    },
    async review(
      paperId: string,
      findingId: string,
      status: CheckDecision['status'] | 'candidate',
      note = '',
    ) {
      return store.unitOfWork(async (tx) => {
        const current = await read(tx, paperId);
        if (!current?.report.checks.some((check) => check.findings.some((f) => f.id === findingId)))
          throw new Error('Check finding not found');
        const before = current.decisions.find((d) => d.findingId === findingId);
        const [lastAudit] = await tx.query('auditEvents', {
          orderBy: 'at',
          desc: true,
          limit: 1,
          select: 'summary',
        });
        const at = new Date(
          Math.max(
            Date.parse(now()),
            Date.parse(
              (lastAudit?.doc as Pick<AuditEvent, 'at'> | undefined)?.at ?? '1970-01-01T00:00:00.000Z',
            ) + 1,
            Date.parse(current.report.generatedAt) + 1,
            Date.parse(current.reviewedAt ?? current.report.generatedAt) + 1,
            ...current.decisions.map((d) => Date.parse(d.at) + 1),
          ),
        ).toISOString();
        const decisions = current.decisions.filter((d) => d.findingId !== findingId);
        if (status !== 'candidate') decisions.push({ findingId, status, note, at });
        const value = PaperChecksRecordSchema.parse({ ...current, decisions, reviewedAt: at });
        await tx.put('paperChecks', paperId, value);
        await appendAudit(
          tx,
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
