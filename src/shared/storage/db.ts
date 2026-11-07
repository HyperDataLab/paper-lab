import Dexie, { type Table } from 'dexie';
import type { Analysis, AuditEvent, Revision, Generation, Paper } from '@/core/schemas';
export class ParagraphDb extends Dexie {
  analyses!: Table<Analysis, string>;
  auditEvents!: Table<AuditEvent, string>;
  revisions!: Table<Revision, string>;
  generations!: Table<Generation, string>;
  papers!: Table<Paper, string>;
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
    this.version(4).stores({ papers: 'id, updatedAt, title' });
  }
}
export function createDb(name?: string) {
  return new ParagraphDb(name);
}
