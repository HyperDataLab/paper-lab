import {
  AnalysisSchema,
  AuditEventSchema,
  validateAnalysisSpans,
  type Analysis,
  type AuditEvent,
} from '@/core/schemas';
import type { DocReader, DocTx } from './docStore';
/** Appends an audit event; an event id is never reused. */
export async function appendAudit(tx: DocTx, event: AuditEvent) {
  const value = AuditEventSchema.parse(event);
  if (tx.appendAudit) await tx.appendAudit(value.id, value);
  else await tx.put('auditEvents', value.id, value, null);
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
export async function readAnalyses(reader: DocReader, paperId?: string, sourceSha256?: string) {
  const where = paperId ? { paperId, ...(sourceSha256 ? { sourceSha256 } : {}) } : undefined;
  const rows = await reader.query('analyses', { where });
  const values: Analysis[] = [];
  let corrupt = 0;
  for (const row of rows) {
    try {
      values.push(checkedAnalysis(row.doc));
    } catch {
      corrupt++;
    }
  }
  return { values, corrupt };
}
export async function readAudit(reader: DocReader, id?: string) {
  const rows = await reader.query('auditEvents', id ? { where: { refId: id } } : undefined);
  const values: AuditEvent[] = [];
  let corrupt = 0;
  for (const row of rows) {
    const result = AuditEventSchema.safeParse(row.doc);
    if (result.success) values.push(result.data);
    else corrupt++;
  }
  return { values, corrupt };
}
