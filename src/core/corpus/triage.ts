import { acceptableKeys, criteriaOf, type Thresholds, type TriageBucket } from '../extraction/triage';
import type { Candidate, Corpus } from '../schemas';
import {
  canScreenFullText,
  deepCandidateFor,
  latestDecision,
  memberSuggestion,
  recordDecision,
  type DecisionError,
  type ScreeningDecision,
  type ScreeningReasonCode,
  type ScreeningStage,
} from './screening';

const STATUS = { include: 'included', exclude: 'excluded', uncertain: 'uncertain' } as const;
const DECISION: Record<TriageBucket, ScreeningDecision> = {
  included: 'include',
  excluded: 'exclude',
  uncertain: 'uncertain',
};

/** The latest protocol's inclusion and exclusion criteria; a journal protocol has none. */
export function corpusPlan(corpus: Corpus) {
  const body = corpus.protocol.at(-1)?.body;
  return body && 'inclusion' in body
    ? { inclusion: body.inclusion, exclusion: body.exclusion }
    : { inclusion: [], exclusion: [] };
}
/** The criteria as the ids (I1…, E1…) the triage prompt and the matched badges use. */
export const corpusCriteria = (corpus: Corpus) => criteriaOf(corpusPlan(corpus));

export function corpusQuestion(corpus: Corpus) {
  const body = corpus.protocol.at(-1)?.body;
  return body && 'researchQuestion' in body ? body.researchQuestion.trim() : '';
}

/**
 * The members a stage screens, as candidates keyed by member id, so the Project triage (batches, buckets,
 * borderline sample, panels) runs on them unchanged. `candidate` means no person decision at the stage yet.
 */
export function triageView(corpus: Corpus, stage: ScreeningStage): Candidate[] {
  const members =
    stage === 'full-text' ? corpus.members.filter((member) => canScreenFullText(member)) : corpus.members;
  return members.map((member) => {
    const found = deepCandidateFor(corpus, member);
    const decision = latestDecision(member, stage);
    return {
      key: member.memberId,
      openalexId: member.identifiers.openalexId ?? found?.openalexId ?? null,
      doi: member.identifiers.doi ?? found?.doi ?? null,
      title: member.title ?? found?.title ?? member.identifiers.doi ?? member.exportId,
      year: member.stratum.year ?? found?.year ?? null,
      authors: found?.authors ?? [],
      venue: found?.venue ?? null,
      abstract: found?.abstract ?? null,
      citedBy: member.citedByCount ?? found?.citedBy ?? null,
      foundBy: found?.foundBy ?? [],
      ...(found?.keywords ? { keywords: found.keywords } : {}),
      ...(found?.workType ? { workType: found.workType } : {}),
      status: decision ? STATUS[decision.decision] : 'candidate',
      suggestion: memberSuggestion(corpus, member, stage),
      reason: decision?.reasonText || null,
      decidedAt: decision?.at ?? null,
    };
  });
}

/**
 * Writes triage results onto the members' suggestions for a stage: `before` and `after` are the view before
 * and after one batch, and only suggestions the batch changed are written. A member decided meanwhile in
 * `corpus` keeps its suggestion, so a checkpoint never touches what a person has decided.
 */
export function storeTriage(
  corpus: Corpus,
  stage: ScreeningStage,
  before: Candidate[],
  after: Candidate[],
  at: string,
): Corpus {
  const old = new Map(before.map((item) => [item.key, item.suggestion]));
  const changed = new Map(
    after.flatMap((item) =>
      item.suggestion &&
      typeof item.suggestion.relevance === 'number' &&
      old.get(item.key) !== item.suggestion
        ? [[item.key, item.suggestion] as const]
        : [],
    ),
  );
  if (!changed.size) return corpus;
  return {
    ...corpus,
    updatedAt: at,
    members: corpus.members.map((member) => {
      const suggestion = changed.get(member.memberId);
      if (!suggestion || latestDecision(member, stage)) return member;
      return { ...member, suggestions: { ...member.suggestions, [stage]: suggestion } };
    }),
  };
}

export type CorpusAcceptInput = {
  person: string;
  /** Required when the bucket is Loại: every exclusion in the log carries a reason code. */
  reasonCode?: ScreeningReasonCode | '';
  reasonText?: string;
};
export type CorpusAcceptResult =
  { ok: true; corpus: Corpus; applied: number } | { ok: false; error: DecisionError };

/**
 * Applies a triage bucket to the given members as one person's decisions, through `recordDecision`, so the
 * decision log, PRISMA counts and sync see ordinary person decisions. Each records the accepted AI suggestion
 * (the corpus form of `ai_accepted`). Only members still undecided at the stage and still in the bucket
 * change; one failing check stops the whole apply.
 */
export function acceptCorpusTriage(
  corpus: Corpus,
  stage: ScreeningStage,
  keys: string[],
  bucket: TriageBucket,
  thresholds: Thresholds,
  input: CorpusAcceptInput,
  at: string,
): CorpusAcceptResult {
  const view = triageView(corpus, stage);
  const reasons = new Map(view.map((item) => [item.key, item.suggestion?.reason ?? '']));
  const accepted = acceptableKeys(view, keys, bucket, thresholds);
  const decision = DECISION[bucket];
  let next = corpus;
  for (const key of accepted) {
    const result = recordDecision(
      next,
      key,
      {
        stage,
        decision,
        reasonCode: input.reasonCode,
        reasonText: input.reasonText,
        person: input.person,
        acceptedSuggestion: { decision, reason: reasons.get(key) ?? '' },
      },
      at,
    );
    if (!result.ok) return result;
    next = result.corpus;
  }
  return { ok: true, corpus: next, applied: accepted.length };
}
