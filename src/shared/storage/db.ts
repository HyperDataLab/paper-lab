import Dexie, { type Table } from 'dexie';
import type { Analysis, AuditEvent, Revision, Generation } from '@/core/schemas';
export class ParagraphDb extends Dexie {
  analyses!: Table<Analysis, string>;
  auditEvents!: Table<AuditEvent, string>;
  revisions!: Table<Revision, string>;
  generations!: Table<Generation, string>;
  constructor(name = 'paragraph-lab') {
    super(name);
    this.version(1).stores({
      analyses: 'id, createdAt, updatedAt, text.sourceHash',
      auditEvents: 'id, analysisId, at',
    });
    this.version(2).stores({
      analyses: 'id, createdAt, updatedAt, text.sourceHash',
      auditEvents: 'id, analysisId, at',
      revisions: 'id, sourceAnalysisId, createdAt',
    });
    this.version(3).stores({
      generations: 'id, createdAt',
    });
  }
}
export function createDb(name?: string) {
  return new ParagraphDb(name);
}
