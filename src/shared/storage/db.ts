import Dexie, { type Table } from 'dexie';
import type {
  Analysis,
  AuditEvent,
  Revision,
  Generation,
  Paper,
  PaperRun,
  PaperOverviewRecord,
  PaperChecksRecord,
} from '@/core/schemas';
export class ParagraphDb extends Dexie {
  analyses!: Table<Analysis, string>;
  auditEvents!: Table<AuditEvent, string>;
  revisions!: Table<Revision, string>;
  generations!: Table<Generation, string>;
  papers!: Table<Paper, string>;
  paperRuns!: Table<PaperRun, string>;
  paperOverviews!: Table<PaperOverviewRecord, string>;
  paperChecks!: Table<PaperChecksRecord, string>;
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
    this.version(5).stores({ paperRuns: 'id, paperId, updatedAt' });
    this.version(6).stores({ paperOverviews: 'paperId' });
    this.version(7).stores({ paperChecks: 'paperId' });
  }
}
export function createDb(name?: string) {
  return new ParagraphDb(name);
}
