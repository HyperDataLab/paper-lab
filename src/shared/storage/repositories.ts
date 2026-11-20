import type { DocStore } from './docStore';
import type { Repositories } from './types';
export type { Repositories } from './types';
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
import { createCorpusTopicsRepository } from './corpusTopics';
import { createCorpusKeywordsRepository } from './corpusKeywords';
import { createCorpusOpenKgRepository } from './corpusOpenKg';
import { createCorporaRepository } from './corpora';
import { createPaperReviewsRepository } from './paperReviews';
import { createPaperProbesRepository } from './paperProbes';
import { createMeasurementsRepository } from './measurements';
import { createLibraryRepository } from './library';
import { createStanceRepository } from './stance';
import { createPaperInsightsRepository } from './paperInsights';
import { createExtractionRepository } from './extractionProjects';
import { createGrobidRepository } from './grobid';
import { createTransferRepository } from './transfer';
import { createResearchDesignRepository } from './researchDesigns';
import { createScgRepository } from './scg';
import { createAutoResearchRepository } from './autoresearch';
import { withChangeEvents } from './changeEvents';
import { paperStoreReads } from './paperStoreReads';
export function createRepositories(
  base: DocStore,
  clock = () => new Date(),
  ids = () => crypto.randomUUID(),
): Repositories {
  const { store: batched, checkpointStore } = paperStoreReads(base);
  // Remote stores have no live queries; readers such as the corpus graph refresh on these write events.
  const { store, subscribe: changes } = withChangeEvents(batched);
  const deps = createStorageDeps(clock, ids);
  const { now, makeAudit } = deps;
  const audit = createAuditRepository(store);
  const calibrationLabels = createCalibrationLabelsRepository(store, deps);
  const analyses = createAnalysesRepository(
    store,
    deps,
    audit.latestAt,
    async () => (await calibrationLabels.list())[0]?.importedAt,
  );
  const generations = createGenerationsRepository(store, deps);
  const library = createLibraryRepository(store, now, ids);
  const paperRecords = createPapersRepository(store, deps);
  const papers: typeof paperRecords = {
    ...paperRecords,
    // Library links are cleared separately to keep the paper deletion commit bounded.
    async delete(id: string) {
      await paperRecords.delete(id);
      await library.detachPaper(id);
    },
  };
  const paperRuns = createPaperRunsRepository(store, deps, checkpointStore);
  const paperOverviews = createPaperOverviewsRepository(store, deps);
  const paperChecks = createPaperChecksRepository(store, deps);
  const paperContext = createPaperContextRepository(store);
  const corpora = createCorporaRepository(store, deps);
  const revisions = createRevisionsRepository(store, deps);
  const paperReviews = createPaperReviewsRepository(store, now, makeAudit, audit.latestAt);
  const paperProbes = createPaperProbesRepository(store, now, makeAudit);
  const measurements = createMeasurementsRepository(store, now, makeAudit, checkpointStore);
  const stance = createStanceRepository(store, now, makeAudit);
  const paperInsights = createPaperInsightsRepository(store, now, makeAudit);
  const extraction = createExtractionRepository(store, now, makeAudit);
  const corpusKeywords = createCorpusKeywordsRepository(store, library, now);
  const scg = createScgRepository(store, clock);
  const transfer = createTransferRepository(store, clock, deps, {
    audit,
    generations,
    papers,
    paperOverviews,
    measurements,
    library,
    calibrationLabels,
    corpora,
  });
  return {
    analyses,
    scg,
    autoresearch: createAutoResearchRepository(store, deps),
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
    researchDesigns: createResearchDesignRepository(store, now),
    corpora,
    corpusProfiles: createCorpusProfilesRepository(store),
    corpusTopics: createCorpusTopicsRepository(store),
    corpusKeywords,
    corpusOpenKg: createCorpusOpenKgRepository(store, changes, corpusKeywords, scg),
    grobid: createGrobidRepository(store),
    calibrationLabels,
    transfer,
  };
}
