import {
  AnalysisSchema,
  AuditEventSchema,
  validateAnalysisSpans,
  type Analysis,
  type AuditEvent,
} from '@/core/schemas';
import type { ParagraphDb } from './db';
import type { DocReader, DocWriter } from './docStore';
/** Appends an audit event; an event id is never reused. */
export async function appendAudit(tx: DocWriter, event: AuditEvent) {
  await tx.put('auditEvents', event.id, AuditEventSchema.parse(event), null);
}
export async function requirePaper(reader: DocReader, paperId: string) {
  const row = await reader.get('papers', paperId);
  if (!row) throw new Error('Paper not found');
  return row.doc;
}
export class SourceImmutableError extends Error {
  override name = 'SourceImmutableError';
}
export function createStorageDeps(clock: () => Date, ids: () => string) {
  const now = () => clock().toISOString();
  const makeAudit = (analysisId: string, action: AuditEvent['action'], actor: AuditEvent['actor']) =>
    AuditEventSchema.parse({
      schemaVersion: 1,
      id: ids(),
      analysisId,
      issueId: null,
      at: now(),
      actor,
      action,
      before: null,
      after: null,
      note: null,
    });
  return { now, ids, makeAudit };
}
export type StorageDeps = ReturnType<typeof createStorageDeps>;
export function checkedAnalysis(value: unknown) {
  const result = validateAnalysisSpans(AnalysisSchema.parse(value));
  if (result.suppressed.length) console.warn('Suppressed invalid analysis spans', result.suppressed);
  return result.valid;
}
export async function readAnalyses(db: ParagraphDb) {
  const rows = await db.analyses.toArray();
  const values: Analysis[] = [];
  let corrupt = 0;
  for (const row of rows) {
    try {
      values.push(checkedAnalysis(row));
    } catch {
      corrupt++;
    }
  }
  return { values, corrupt };
}
export async function readAudit(db: ParagraphDb) {
  const rows = await db.auditEvents.toArray();
  const values: AuditEvent[] = [];
  let corrupt = 0;
  for (const row of rows) {
    const result = AuditEventSchema.safeParse(row);
    if (result.success) values.push(result.data);
    else corrupt++;
  }
  return { values, corrupt };
}
