import type { StoredCorpusProfile } from '@/core/schemas/corpusProfile';
import type { PdfFileRecord } from './pdfFiles';
import type {
  ExtractionProject,
  GrobidRecord,
  PaperContextRecord,
  PaperInsightsRecord,
} from '@/core/schemas';
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
  PaperReviewsRecord,
  MeasurementsRecord,
  LibraryItem,
  StanceRecord,
  PaperProbesRecord,
  CalibrationLabelSet,
  Corpus,
} from '@/core/schemas';
import type { ReviewNgram } from '@/core/reviewPanel';
export class ParagraphDb extends Dexie {
  analyses!: Table<Analysis, string>;
  auditEvents!: Table<AuditEvent, string>;
  revisions!: Table<Revision, string>;
  generations!: Table<Generation, string>;
  papers!: Table<Paper, string>;
  paperRuns!: Table<PaperRun, string>;
  paperOverviews!: Table<PaperOverviewRecord, string>;
  paperChecks!: Table<PaperChecksRecord, string>;
  paperReviews!: Table<PaperReviewsRecord, string>;
  paperProbes!: Table<PaperProbesRecord, string>;
  measurements!: Table<MeasurementsRecord, string>;
  library!: Table<LibraryItem, string>;
  stance!: Table<StanceRecord, string>;
  paperContext!: Table<PaperContextRecord, string>;
  paperInsights!: Table<PaperInsightsRecord, string>;
  corpora!: Table<Corpus, string>;
  corpusProfiles!: Table<StoredCorpusProfile, string>;
  corpusSync!: Table<{ id: string; version: string; snapshot: string }, string>;
  extractionProjects!: Table<ExtractionProject, string>;
  reviewNgrams!: Table<ReviewNgram, [string, string]>;
  calibrationLabels!: Table<CalibrationLabelSet, string>;
  pdfFiles!: Table<PdfFileRecord, string>;
  grobid!: Table<GrobidRecord, string>;
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
    this.version(8).stores({ paperReviews: 'paperId', reviewNgrams: '[hash+paperId], paperId' });
    this.version(9).stores({ paperProbes: 'paperId' });
    this.version(10).stores({ calibrationLabels: 'id, importedAt' });
    this.version(11).stores({ measurements: 'paperId' });
    this.version(12).stores({ library: 'id, &doi, paper_id' });
    this.version(13).stores({ stance: 'paperId' });
    this.version(14).stores({ paperContext: 'paperId' });
    this.version(15).stores({ paperInsights: 'paperId' });
    this.version(16).stores({ extractionProjects: 'id, updatedAt' });
    this.version(17).stores({ pdfFiles: 'sha256' });
    this.version(18).stores({ corpora: 'id, updatedAt, kind' });
    this.version(19).stores({ corpusSync: 'id' });
    this.version(20).stores({ corpusProfiles: 'corpusId' });
    this.version(21).stores({ grobid: 'paperId' });
  }
}
export function createDb(name?: string) {
  return new ParagraphDb(name);
}
