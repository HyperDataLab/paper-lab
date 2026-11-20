import type { KeywordPaper } from '@/core/schemas/corpusKeywords';
import type { createAnalysesRepository } from './analyses';
import type { createAuditRepository } from './audit';
import type { createAutoResearchRepository } from './autoresearch';
import type { createCalibrationLabelsRepository } from './calibrationLabels';
import type { createCorporaRepository } from './corpora';
import type { createCorpusKeywordsRepository } from './corpusKeywords';
import type { createCorpusOpenKgRepository } from './corpusOpenKg';
import type { createCorpusProfilesRepository } from './corpusProfiles';
import type { createCorpusTopicsRepository } from './corpusTopics';
import type { createExtractionRepository } from './extractionProjects';
import type { createGenerationsRepository } from './generations';
import type { createGrobidRepository } from './grobid';
import type { createLibraryRepository } from './library';
import type { createMeasurementsRepository } from './measurements';
import type { createPaperChecksRepository } from './paperChecks';
import type { createPaperContextRepository } from './paperContext';
import type { createPaperInsightsRepository } from './paperInsights';
import type { createPaperOverviewsRepository } from './paperOverviews';
import type { createPaperProbesRepository } from './paperProbes';
import type { createPaperReviewsRepository } from './paperReviews';
import type { createPaperRunsRepository } from './paperRuns';
import type { createPapersRepository } from './papers';
import type { createResearchDesignRepository } from './researchDesigns';
import type { createRevisionsRepository } from './revisions';
import type { createScgRepository } from './scg';
import type { createStanceRepository } from './stance';
import type { createTransferRepository } from './transfer';

/** Everything the app may read or write. Modules depend on this, never on a storage engine. */
export interface Repositories {
  analyses: ReturnType<typeof createAnalysesRepository>;
  scg: ReturnType<typeof createScgRepository>;
  autoresearch: ReturnType<typeof createAutoResearchRepository>;
  audit: ReturnType<typeof createAuditRepository>;
  revisions: ReturnType<typeof createRevisionsRepository>;
  generations: ReturnType<typeof createGenerationsRepository>;
  papers: ReturnType<typeof createPapersRepository>;
  paperRuns: ReturnType<typeof createPaperRunsRepository>;
  paperOverviews: ReturnType<typeof createPaperOverviewsRepository>;
  paperChecks: ReturnType<typeof createPaperChecksRepository>;
  paperReviews: ReturnType<typeof createPaperReviewsRepository>;
  paperProbes: ReturnType<typeof createPaperProbesRepository>;
  measurements: ReturnType<typeof createMeasurementsRepository>;
  library: ReturnType<typeof createLibraryRepository>;
  stance: ReturnType<typeof createStanceRepository>;
  paperContext: ReturnType<typeof createPaperContextRepository>;
  paperInsights: ReturnType<typeof createPaperInsightsRepository>;
  extraction: ReturnType<typeof createExtractionRepository>;
  researchDesigns: ReturnType<typeof createResearchDesignRepository>;
  corpora: ReturnType<typeof createCorporaRepository>;
  corpusProfiles: ReturnType<typeof createCorpusProfilesRepository>;
  corpusTopics: ReturnType<typeof createCorpusTopicsRepository>;
  corpusKeywords: ReturnType<typeof createCorpusKeywordsRepository>;
  corpusOpenKg: ReturnType<typeof createCorpusOpenKgRepository>;
  grobid: ReturnType<typeof createGrobidRepository>;
  calibrationLabels: ReturnType<typeof createCalibrationLabelsRepository>;
  transfer: ReturnType<typeof createTransferRepository>;
}

export type FreezeForRun = { runId: string; revision: number; designVersion: number };

/** A member whose keywords have not been fetched yet; `libraryId` is where they will be saved, if it has a record. */
export interface KeywordTarget {
  memberId: string;
  doi: string;
  libraryId: string | null;
}
export interface MemberKeywords {
  papers: KeywordPaper[];
  missing: KeywordTarget[];
  /** Members with no keywords and no DOI to look them up by. */
  withoutDoi: number;
}
