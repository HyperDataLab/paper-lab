import Dexie, { type Table } from 'dexie';
import type { Analysis, AuditEvent } from '@/core/schemas';
export class ParagraphDb extends Dexie {
  analyses!: Table<Analysis, string>;
  auditEvents!: Table<AuditEvent, string>;
  constructor(name = 'paragraph-lab') {
    super(name);
    this.version(1).stores({
      analyses: 'id, createdAt, updatedAt, text.sourceHash',
      auditEvents: 'id, analysisId, at',
    });
  }
}
export function createDb(name?: string) {
  return new ParagraphDb(name);
}
