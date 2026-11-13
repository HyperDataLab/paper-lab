import type { ParagraphDb } from './db';
import { createStorageDeps } from './storageShared';
export { SourceImmutableError } from './storageShared';
export type { AnalysisPatch } from './analyses';
import { createAnalysesRepository } from './analyses';
import { createAuditRepository } from './audit';
import { createRevisionsRepository } from './revisions';
import { createGenerationsRepository } from './generations';
import { createPapersRepository } from './papers';
import { createPaperRunsRepository } from './paperRuns';
import { createPaperOverviewsRepository } from './paperOverviews';
import { createPaperChecksRepository } from './paperChecks';
import { createPaperContextRepository } from './paperContext';
import { createCalibrationLabelsRepository } from './calibrationLabels';
import { createCorpusProfilesRepository } from './corpusProfiles';
import { createCorporaRepository } from './corpora';
import { createPaperReviewsRepository } from './paperReviews';
import { createPaperProbesRepository } from './paperProbes';
import { createMeasurementsRepository } from './measurements';
import { createLibraryRepository } from './library';
import { createStanceRepository } from './stance';
import { createPaperInsightsRepository } from './paperInsights';
import { createExtractionRepository } from './extractionProjects';
import { createPdfFilesRepository } from './pdfFiles';
import { createGrobidRepository } from './grobid';
import { createTransferRepository } from './transfer';
export function createRepositories(
  db: ParagraphDb,
  clock = () => new Date(),
  ids = () => crypto.randomUUID(),
) {
  const deps = createStorageDeps(clock, ids);
  const { now, makeAudit } = deps;
  const analyses = createAnalysesRepository(db, deps);
  const audit = createAuditRepository(db);
  const generations = createGenerationsRepository(db, deps);
  const papers = createPapersRepository(db, deps);
  const paperRuns = createPaperRunsRepository(db, deps);
  const paperOverviews = createPaperOverviewsRepository(db, deps, analyses, papers);
  const paperChecks = createPaperChecksRepository(db, deps, papers);
  const paperContext = createPaperContextRepository(db);
  const calibrationLabels = createCalibrationLabelsRepository(db, deps);
  const corpora = createCorporaRepository(db);
  const revisions = createRevisionsRepository(db, deps, analyses);
  const paperReviews = createPaperReviewsRepository(db, now, makeAudit);
  const paperProbes = createPaperProbesRepository(db, now, makeAudit);
  const measurements = createMeasurementsRepository(db, now, makeAudit);
  const stance = createStanceRepository(db, now, makeAudit);
  const paperInsights = createPaperInsightsRepository(db, now, makeAudit);
  const extraction = createExtractionRepository(db, now, makeAudit);
  const library = createLibraryRepository(db, now, ids);
  const pdfFiles = createPdfFilesRepository(db, now);
  const transfer = createTransferRepository(db, clock, deps, {
    analyses,
    audit,
    generations,
    papers,
    paperOverviews,
    paperChecks,
    paperReviews,
    paperProbes,
    measurements,
    library,
    stance,
    paperInsights,
    calibrationLabels,
    corpora,
  });
  return {
    analyses,
    audit,
    revisions,
    generations,
    papers,
    paperRuns,
    paperOverviews,
    paperChecks,
    paperReviews,
    paperProbes,
    measurements,
    library,
    stance,
    paperContext,
    paperInsights,
    extraction,
    corpora,
    corpusProfiles: createCorpusProfilesRepository(db),
    pdfFiles,
    grobid: createGrobidRepository(db),
    calibrationLabels,
    transfer,
  };
}
export type Repositories = ReturnType<typeof createRepositories>;
