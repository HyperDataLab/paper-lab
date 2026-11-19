import { buildArgumentMap } from './argument-map';
import type { Charter, Inputs, StageContent } from './contracts';
import type { CriticReport, PiDecision } from './reviews';

export const at = '2026-01-01T00:00:00.000Z';
export const charter: Charter = {
  question: 'Does reviewer calibration improve agreement on fictional artifacts?',
  objectives: ['Compare reviewer agreement', 'Measure repeatability'],
  scope_in: ['Synthetic artifacts'],
  scope_out: ['Field trials'],
  success_criteria: ['Document both positive and negative results'],
  kill_criteria: ['Reviewers are unavailable'],
  constraints: ['Use simulated tasks'],
  risk_posture: 'exploratory',
};
const hypothesis = {
  id: 'h-agree',
  statement: 'Calibration increases agreement between reviewers.',
  gapId: 'g-agree',
  subQuestionIds: ['q-agree'],
  evidenceRefs: ['card-a'],
  outcome: 'Reviewer agreement',
  estimand: 'Difference in agreement between groups',
  prediction: '> 0' as const,
  falsification: { criterion: 'Agreement does not increase under calibration.', threshold: null },
  novelty: {
    assessment: 'The comparison paper did not test this intervention.',
    paperIds: ['title:fictional study'],
  },
  risk: 'Reviewers may remember the calibration examples.',
};
const views: StageContent['S8']['perspectives'] = [
  { lens: 'novelty', assessment: 'Novelty is uncertain.', hypothesisIds: ['h-agree', 'h-repeat'] },
  { lens: 'feasibility', assessment: 'Simulation is feasible.', hypothesisIds: ['h-agree', 'h-repeat'] },
  { lens: 'soundness', assessment: 'Control the order effects.', hypothesisIds: ['h-agree', 'h-repeat'] },
];
const ar1Outputs: Omit<StageContent, 'S9'> = {
  S1: {
    charter,
    goal: {
      problem: 'Agreement can vary.',
      objective: 'Compare agreement.',
      scope: ['Simulation'],
      success_criteria: charter.success_criteria,
      researchable: true,
      rejectionReason: null,
    },
  },
  S2: {
    subQuestions: [
      { id: 'q-agree', question: 'What changes reviewer agreement?' },
      { id: 'q-repeat', question: 'What changes repeatability?' },
      { id: 'q-control', question: 'What controls are needed?' },
    ],
    scores: { novelty: 0.75, specificity: 0.75, feasibility: 0.75 },
    rationale: 'A bounded simulation.',
    overall: 0.75,
  },
  S3: {
    strategies: [
      {
        name: 'Intervention terms',
        queries: [{ id: 'search-a', query: 'reviewer calibration', subQuestionIds: ['q-agree', 'q-repeat'] }],
      },
      {
        name: 'Control terms',
        queries: [{ id: 'search-b', query: 'simulation controls', subQuestionIds: ['q-control'] }],
      },
    ],
    yearFilter: { from: null, to: null },
    inclusion: ['Fictional reviewer studies'],
    exclusion: ['Field trials'],
  },
  S4: {
    candidates: [
      {
        id: 'title:fictional study',
        doi: null,
        title: 'Fictional study',
        abstract: 'Compared 12 reviewers and reported disagreement.',
        year: null,
        citationKey: 'P1',
        queryIds: ['search-a'],
        queryLink: 'matched_harvest',
        sources: [{ kind: 'harvest', ref: 'fictional study' }],
        existingDecision: null,
      },
    ],
  },
  S5: {
    decisions: [
      {
        id: 'screen:title:fictional study',
        paperId: 'title:fictional study',
        decision: 'included',
        reason: 'Reports reviewer outcomes.',
        relevance: null,
        quality: null,
      },
    ],
    thresholds: { relevance: null, quality: null },
  },
  S6: {
    cards: [
      {
        id: 'card-a',
        decisionId: 'screen:title:fictional study',
        problem: 'Reviewer disagreement',
        method: 'Compared 12 reviewers',
        data: null,
        metrics: null,
        findings: 'Reported disagreement.',
        limitations: null,
        evidence_scope: 'abstract',
      },
    ],
  },
  S7: {
    clusters: [{ label: 'Reviewer differences', summary: 'Compared 12 reviewers.', cardIds: ['card-a'] }],
    setAside: [],
    gaps: [
      {
        id: 'g-agree',
        text: 'Calibration was not tested.',
        subQuestionIds: ['q-agree'],
        cardIds: ['card-a'],
      },
      {
        id: 'g-repeat',
        text: 'Repeatability was not tested.',
        subQuestionIds: ['q-repeat'],
        cardIds: ['card-a'],
      },
    ],
  },
  S8: {
    hypotheses: [
      hypothesis,
      {
        ...hypothesis,
        id: 'h-repeat',
        gapId: 'g-repeat',
        subQuestionIds: ['q-repeat'],
        statement: 'Randomizing item order reduces within-reviewer variation.',
      },
    ],
    perspectives: views,
    debateRounds: [{ views }],
    noveltyMethod: 'heuristic',
    noveltySearches: [],
    retrievedPapers: [
      { id: 'title:fictional study', title: 'Fictional study', abstract: null, source: 'pool' },
    ],
  },
};
export function argumentJudgments(hypothesisIds: string[]) {
  return {
    claims: [{ id: 'claim-a', clusterId: 'cluster:1', text: 'Reviewer disagreement was observed.' }],
    evidence_links: [
      {
        cardId: 'card-a',
        claimId: 'claim-a',
        relation: 'supports' as const,
        rationale: 'The study reports disagreement.',
      },
    ],
    rationales: hypothesisIds.map((hypothesisId) => ({
      claimId: 'claim-a',
      hypothesisId,
      polarity: 'supports' as const,
      rationale: 'Reviewer differences motivate a test.',
    })),
    entities: [],
    relations: [],
  };
}
export const argumentFixture = (prior: Inputs) =>
  buildArgumentMap(prior, argumentJudgments(prior.S8?.hypotheses.map(({ id }) => id) ?? []));
export const outputs: StageContent = { ...ar1Outputs, S9: argumentFixture(ar1Outputs) };
export const seriousPoint: CriticReport['points'][number] = {
  id: 'point-a',
  lens: 'charter',
  ref: 'charter:objectives[0]',
  itemId: null,
  severity: 'serious',
  fixClass: 'needs_evidence',
  text: 'Report reviewer allocation.',
};
export const critic: CriticReport = { points: [], resolutions: [], verdict: 'sound' };
export const pi: PiDecision = {
  action: 'accept',
  selectionIds: [],
  target: null,
  note: null,
  rationale: 'The candidate follows the charter.',
  confidence: null,
  options: [{ action: 'accept', selectionIds: [], rationale: 'The references resolved.' }],
  answers: [],
  directiveIds: [],
  problem: null,
  handoff: ['Preserve uncertainty.'],
  notebook: [],
};
