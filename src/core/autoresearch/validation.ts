import type { Inputs, Stage, StageContent, StageError } from './contracts';

export const TOPIC_MINIMUM = 0.5; // Heuristic triage threshold, subject to calibration.
export const TOPIC_RUBRIC_VERSION = 'ar-topic-1';
export function overallTopicScore(scores: StageContent['S2']['scores']) {
  const { novelty, specificity, feasibility } = scores;
  return novelty === null || specificity === null || feasibility === null
    ? null
    : (novelty + specificity + feasibility) / 3;
}

type Item = { id: string };
const ids = (items: Item[]) => new Set(items.map((item) => item.id));
const unique = (values: string[]) => new Set(values).size === values.length;
const known = (values: string[], allowed: Set<string>) =>
  unique(values) && values.every((value) => allowed.has(value));
const uniqueItems = (items: Item[]) => ids(items).size === items.length;
const numbers = (text: string) => text.match(/(?<![\p{L}\d])[-+−]?\d+(?:[.,]\d+)*/gu) ?? [];
const numericGrounding = (value: string, source: string) => {
  const observed = new Set(numbers(source));
  return numbers(value).every((number) => observed.has(number));
};
export const searchQueries = (plan: StageContent['S3']) =>
  plan.strategies.flatMap((strategy) => strategy.queries);
const cardFields = ['problem', 'method', 'data', 'metrics', 'findings', 'limitations'] as const;
const cardText = (card: StageContent['S6']['cards'][number]) => cardFields.map((key) => card[key]).join(' ');

export function cardQuestionLinks(prior: Inputs) {
  const queryQuestions = new Map(prior.S3 && searchQueries(prior.S3).map((q) => [q.id, q.subQuestionIds]));
  const paperQueries = new Map(prior.S4?.candidates.map((p) => [p.id, p.queryIds]));
  const decisionPapers = new Map(
    prior.S5?.decisions.filter((d) => d.decision === 'included').map((d) => [d.id, d.paperId]),
  );
  return new Map(
    prior.S6?.cards.map((card) => [
      card.id,
      new Set(
        (paperQueries.get(decisionPapers.get(card.decisionId) ?? '') ?? []).flatMap(
          (queryId) => queryQuestions.get(queryId) ?? [],
        ),
      ),
    ]),
  );
}
function connects(prior: Inputs) {
  const mapping = cardQuestionLinks(prior);
  return (questionIds: string[], cardIds: string[]) =>
    questionIds.every((id) => cardIds.some((cardId) => mapping.get(cardId)?.has(id))) &&
    cardIds.every((cardId) => questionIds.some((id) => mapping.get(cardId)?.has(id)));
}

function checkCards(value: StageContent['S6'], prior: Inputs): StageError | null {
  if (!value.cards.length) return 'NO_CARDS';
  const papers = new Map(prior.S4?.candidates.map((paper) => [paper.id, paper]));
  const decisions = new Map(
    prior.S5?.decisions.filter((d) => d.decision === 'included').map((d) => [d.id, d]),
  );
  if (!uniqueItems(value.cards) || !unique(value.cards.map((card) => card.decisionId)))
    return 'INVALID_CARDS';
  for (const card of value.cards) {
    const decision = decisions.get(card.decisionId);
    const paper = decision && papers.get(decision.paperId);
    if (!paper?.abstract || card.evidence_scope !== 'abstract') return 'INVALID_CARDS';
    if (!cardFields.some((key) => card[key] !== null)) return 'INVALID_CARDS';
    if (
      cardFields.some((key) =>
        /^(?:n\/?a|tbd|todo|placeholder|not (?:provided|available|specified)|unknown|none|\[.*\])[.!]?$/iu.test(
          card[key] ?? '',
        ),
      )
    )
      return 'INVALID_CARDS';
    if (!numericGrounding(cardText(card), paper.abstract)) return 'INVALID_CARDS';
  }
  return null;
}

function checkSynthesis(value: StageContent['S7'], prior: Inputs): StageError | null {
  const cards = new Map(prior.S6?.cards.map((card) => [card.id, card]));
  const questions = ids(prior.S2?.subQuestions ?? []);
  const connected = connects(prior);
  const covered = [...value.clusters.flatMap((c) => c.cardIds), ...value.setAside.map((c) => c.cardId)];
  const supportedNumbers = (text: string, refs: string[]) =>
    numericGrounding(
      text,
      refs
        .map((ref) => {
          const card = cards.get(ref);
          return card ? cardText(card) : '';
        })
        .join(' '),
    );
  if (
    covered.length !== cards.size ||
    !known(covered, new Set(cards.keys())) ||
    !uniqueItems(value.gaps) ||
    value.clusters.some((c) => !supportedNumbers(`${c.label} ${c.summary}`, c.cardIds)) ||
    value.setAside.some((c) => !supportedNumbers(c.reason, [c.cardId])) ||
    value.gaps.some(
      (g) =>
        !known(g.subQuestionIds, questions) ||
        !known(g.cardIds, new Set(cards.keys())) ||
        !connected(g.subQuestionIds, g.cardIds) ||
        !g.cardIds.every((id) => value.clusters.some((cluster) => cluster.cardIds.includes(id))) ||
        !supportedNumbers(g.text, g.cardIds),
    )
  )
    return 'INVALID_SYNTHESIS';
  return null;
}

function similar(a: string, b: string) {
  const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const left = words(a);
  const right = words(b);
  const overlap = [...left].filter((word) => right.has(word)).length;
  return overlap / new Set([...left, ...right]).size >= 0.85;
}

function checkHypotheses(value: StageContent['S8'], prior: Inputs): StageError | null {
  const gaps = new Map(prior.S7?.gaps.map((gap) => [gap.id, gap]));
  const papers = new Map(value.retrievedPapers.map((paper) => [paper.id, paper]));
  const cards = new Map(prior.S6?.cards.map((card) => [card.id, card]));
  const hypotheses = ids(value.hypotheses);
  const connected = connects(prior);
  const plannedQueries = new Set(prior.S3 ? searchQueries(prior.S3).map((q) => q.id) : []);
  const perspectives = (views: StageContent['S8']['perspectives']) =>
    views.length === 3 &&
    unique(views.map((view) => view.lens)) &&
    views.every(
      (view) => known(view.hypothesisIds, hypotheses) && view.hypothesisIds.length === hypotheses.size,
    );
  if (
    !uniqueItems(value.hypotheses) ||
    papers.size !== value.retrievedPapers.length ||
    !known(
      value.noveltySearches.map((search) => search.queryId),
      plannedQueries,
    ) ||
    value.noveltySearches.some(
      (search) =>
        !known(search.paperIds, new Set(papers.keys())) ||
        (search.status === 'unavailable' && search.paperIds.length > 0),
    ) ||
    !perspectives(value.perspectives) ||
    value.debateRounds.some((round) => !perspectives(round.views))
  )
    return 'INVALID_HYPOTHESES';
  for (const [index, h] of value.hypotheses.entries()) {
    const gap = gaps.get(h.gapId);
    if (
      !gap ||
      !known(h.subQuestionIds, new Set(gap.subQuestionIds)) ||
      !known(h.evidenceRefs, new Set(gap.cardIds)) ||
      !known(h.novelty.paperIds, new Set(papers.keys())) ||
      !connected(h.subQuestionIds, h.evidenceRefs) ||
      value.hypotheses.slice(0, index).some((other) => similar(other.statement, h.statement))
    )
      return 'INVALID_HYPOTHESES';
    const evidence = h.evidenceRefs
      .map((id) => {
        const card = cards.get(id);
        return card ? cardText(card) : '';
      })
      .join(' ');
    if (
      !numericGrounding(
        [
          h.statement,
          h.outcome,
          h.estimand,
          h.falsification.criterion,
          h.falsification.threshold,
          h.risk,
        ].join(' '),
        evidence,
      )
    )
      return 'INVALID_HYPOTHESES';
    const comparison = h.novelty.paperIds
      .map((id) => {
        const paper = papers.get(id);
        return `${paper?.title} ${paper?.abstract ?? ''}`;
      })
      .join(' ');
    if (!numericGrounding(h.novelty.assessment, comparison)) return 'INVALID_HYPOTHESES';
  }
  return null;
}

export const passConditions: {
  [K in Stage]: (value: StageContent[K], prior: Inputs) => StageError | null;
} = {
  S1: ({ charter, goal }) =>
    goal.researchable &&
    goal.rejectionReason === null &&
    goal.success_criteria.length === charter.success_criteria.length &&
    goal.success_criteria.every((criterion, index) => criterion === charter.success_criteria[index])
      ? null
      : 'INVALID_GOAL',
  S2: (value) =>
    !uniqueItems(value.subQuestions) ||
    value.overall !== overallTopicScore(value.scores) ||
    value.overall === null ||
    value.overall < TOPIC_MINIMUM
      ? 'TOPIC_BELOW_THRESHOLD'
      : null,
  S3: (value, prior) => {
    const queries = searchQueries(value);
    const questions = ids(prior.S2?.subQuestions ?? []);
    const covered = new Set(queries.flatMap((q) => q.subQuestionIds));
    const { from, to } = value.yearFilter;
    const preregistered = Object.values(prior.S1?.charter ?? {})
      .flat()
      .join(' ');
    return (from !== null && to !== null && from > to) ||
      !numericGrounding([from, to].join(' '), preregistered) ||
      !uniqueItems(queries) ||
      !unique(value.strategies.map((s) => s.name.toLowerCase())) ||
      queries.some((query) => !known(query.subQuestionIds, questions)) ||
      covered.size !== questions.size
      ? 'INVALID_SEARCH_PLAN'
      : null;
  },
  S4: ({ candidates }, prior) => {
    const queries = ids(prior.S3 ? searchQueries(prior.S3) : []);
    return !candidates.length
      ? 'MISSING_INPUT'
      : !uniqueItems(candidates) || candidates.some((paper) => !known(paper.queryIds, queries))
        ? 'STAGE_ERROR'
        : null;
  },
  S5: ({ decisions }, prior) => {
    const papers = prior.S4?.candidates ?? [];
    if (
      !uniqueItems(decisions) ||
      decisions.length !== papers.length ||
      !known(
        decisions.map((d) => d.paperId),
        ids(papers),
      )
    )
      return 'STAGE_ERROR';
    return decisions.some((d) => d.decision === 'included') ? null : 'EMPTY_SHORTLIST';
  },
  S6: checkCards,
  S7: checkSynthesis,
  S8: checkHypotheses,
};

export function passStage<K extends Stage>(
  stage: K,
  value: StageContent[K],
  prior: Inputs,
): StageError | null {
  return passConditions[stage](value, prior);
}
