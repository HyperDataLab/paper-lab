import { buildGeneration } from '@/core/generation';
import { fixturePaper, fixtureRun } from '@/core/measurement/testFixture';
import { aggregatePaper } from '@/core/paperOverview';
import { GROBID_VERSION, type PaperRun } from '@/core/schemas';
import { analyzeText } from '@/core/text/analyzeText';
import { testId } from '../remoteTestSupport';
import type { PAPER_COLLECTIONS } from './paperCollections';

export const at = '2026-11-20T00:00:00.000Z';
export const paper = fixturePaper;
const paperId = paper.id;
const perPaper = { schemaVersion: 1, paperId };

export function paperRun(): PaperRun {
  return {
    schemaVersion: 1,
    id: testId(3),
    paperId,
    createdAt: at,
    updatedAt: at,
    status: 'idle',
    model: 'synthetic',
    budget: 5,
    callsUsed: 0,
    promptVersions: {},
    plan: {
      sectionIds: [],
      paragraphs: [],
      skipped: [],
      steps: [],
      budget: 5,
      total: 0,
      withinBudget: true,
      calls: { syntax: 0, judge: 0, structure: 0, score: 0 },
    },
    items: [],
  };
}

export async function paperBodies(): Promise<Record<(typeof PAPER_COLLECTIONS)[number], unknown>> {
  const sentence = 'The samples grew.';
  const text = await analyzeText(sentence);
  const analysisId = testId(4);
  return {
    papers: paper,
    paperRuns: paperRun(),
    paperOverviews: { ...perPaper, overview: aggregatePaper(paper, []), transitions: null },
    paperChecks: {
      ...perPaper,
      report: { version: 'checks-1', generatedAt: at, checks: [], droppedLocations: 0 },
      decisions: [],
    },
    paperReviews: { ...perPaper, updatedAt: at, runs: [], humanNotes: null, decisions: [] },
    paperProbes: { ...perPaper, updatedAt: at, runs: [] },
    measurements: { ...perPaper, updatedAt: at, runs: [fixtureRun()], decisions: [], pending: null },
    stance: { ...perPaper, updatedAt: at, runs: [], decisions: [], pending: null },
    paperContext: { ...perPaper, checkedAt: at, checked: 0, found: 0, paperDoi: null, retracted: [] },
    paperInsights: { ...perPaper, updatedAt: at, rhetoricRuns: [], rhetoricPending: null, decisions: [] },
    grobid: {
      ...perPaper,
      schemaVersion: 3,
      sha256: paper.source.sha256,
      version: GROBID_VERSION,
      fetchedAt: at,
      status: 'failed',
      error: 'Synthetic failure',
      result: null,
    },
    scgRuns: {
      ...perPaper,
      doi: '10.1000/synthetic',
      s2CorpusId: null,
      s2CheckedAt: null,
      idBase: 'synthetic',
      promptVersion: 'a+b+c',
      promptVersions: { contributions: 'a', prerequisites: 'b', alignment: 'c' },
      requestedModel: 'synthetic',
      model: 'synthetic',
      status: 'complete',
      callsUsed: 3,
      dropped: { quotes: 0, contributions: 0, prerequisites: 0, references: 0, matches: 0 },
      contributions: [],
      progress: { fingerprint: 'f', contributionBatches: {}, prerequisitesDone: [], alignmentDone: [] },
      reviewCarry: {},
      createdAt: at,
      updatedAt: at,
    },
    analyses: {
      schemaVersion: 1,
      id: analysisId,
      createdAt: at,
      updatedAt: at,
      title: 'Synthetic paragraph',
      text,
      context: { before: null, after: null, audience: null },
      contextLimited: true,
      versions: { rubric: null, prompt: null, model: null, syntaxProvider: null },
      sentenceAnnotations: [],
      issues: [],
      parentAnalysisId: null,
      origin: { kind: 'paper', paperId, paragraphId: 'synthetic' },
    },
    revisions: {
      schemaVersion: 1,
      id: testId(5),
      sourceAnalysisId: analysisId,
      sourceHash: text.sourceHash,
      revisedText: sentence,
      revisedHash: text.sourceHash,
      hunks: [],
      changes: [],
      unmatchedChanges: [],
      needsEvidence: [],
      checks: [],
      appliedIssueIds: [],
      promptVersion: 'synthetic',
      model: 'synthetic',
      createdAt: at,
    },
    generations: buildGeneration(
      {
        mainClaim: sentence,
        evidence: [{ id: 'e1', text: sentence, citation: null }],
        audience: 'general',
        structure: 'auto',
        preserveTerms: [],
        hedging: 'cautious',
      },
      {
        paragraph: sentence,
        sentences: [{ text: sentence, role: 'topic_sentence', evidenceIds: ['e1'], usesClaim: true }],
        needsEvidence: [],
      },
      { id: testId(6), model: 'synthetic', createdAt: at },
    ),
    reviewNgrams: { paperId, hash: text.sourceHash },
    paperCheckpointParts: {
      ...perPaper,
      id: 'synthetic:chunk',
      kind: 'chunk',
      refId: 'synthetic',
      hash: text.sourceHash,
      data: 'synthetic',
    },
  };
}
