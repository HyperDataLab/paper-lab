import { AuditEventSchema, type AuditEvent } from '@/core/schemas';
import { readAudit } from './storageShared';
import type { ParagraphDb } from './db';
export function createAuditRepository(db: ParagraphDb) {
  const audit = {
    async append(event: AuditEvent) {
      await db.auditEvents.add(AuditEventSchema.parse(event));
    },
    async listAll() {
      const { values, corrupt } = await readAudit(db);
      return { items: values.sort((a, b) => a.at.localeCompare(b.at)), corrupt };
    },
    async listByAnalysis(id: string) {
      const result = await audit.listAll();
      return { ...result, items: result.items.filter((event) => event.analysisId === id) };
    },
  };
  return audit;
}
