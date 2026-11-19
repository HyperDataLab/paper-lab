import type { Candidate, CandidateSuggestion, Corpus, CorpusDecision, CorpusMember } from '../schemas';

/** The fixed exclusion reasons (PRISMA 2020 "reports excluded, with reasons"). Labels live in the module. */
export const SCREENING_REASON_CODES = [
  'wrong_population',
  'wrong_topic',
  'wrong_outcome',
  'wrong_design',
  'not_peer_reviewed',
  'duplicate',
  'not_english',
  'full_text_unavailable',
  'other',
] as const;
export type ScreeningReasonCode = (typeof SCREENING_REASON_CODES)[number];
export type ScreeningStage = CorpusDecision['stage'];
export type ScreeningDecision = CorpusDecision['decision'];

/** Older records (promoted from deep research) may carry any string; they count as `other`. */
export function reasonCodeOf(value: string): ScreeningReasonCode {
  return (SCREENING_REASON_CODES as readonly string[]).includes(value)
    ? (value as ScreeningReasonCode)
    : 'other';
}

/**
 * The decision that counts for a stage: the latest person decision by time. Logs merged from two members are
 * concatenated, so array order is only the tie-break. AI suggestions never count.
 */
export function latestDecision(member: CorpusMember, stage: ScreeningStage): CorpusDecision | undefined {
  let best: { decision: CorpusDecision; index: number } | undefined;
  member.decisions.forEach((decision, index) => {
    if (decision.stage !== stage || decision.decider.kind !== 'person') return;
    if (!best || decision.at > best.decision.at || (decision.at === best.decision.at && index > best.index))
      best = { decision, index };
  });
  return best?.decision;
}

/** Full-text screening is offered only for members included at title-abstract. */
export function canScreenFullText(member: CorpusMember): boolean {
  return latestDecision(member, 'title-abstract')?.decision === 'include';
}

/** Included in the review: full-text include after a title-abstract include, as PRISMA counts it. */
export function isIncluded(member: CorpusMember): boolean {
  return canScreenFullText(member) && latestDecision(member, 'full-text')?.decision === 'include';
}

export type AiSuggestion = { decision: ScreeningDecision; reason: string };

const sameRecord = (item: Candidate, member: CorpusMember) =>
  Boolean(
    (item.doi && item.doi === member.identifiers.doi) ||
    (item.openalexId && item.openalexId === member.identifiers.openalexId),
  );

/** The search record a member came from, matched by DOI or OpenAlex id; it holds the abstract and venue. */
export const deepCandidateFor = (corpus: Corpus, member: CorpusMember): Candidate | undefined =>
  corpus.deep?.candidates.find((item) => sameRecord(item, member));

/** The AI suggestion stored on the member for a stage; title-abstract falls back to the search record's. */
export function memberSuggestion(
  corpus: Corpus,
  member: CorpusMember,
  stage: ScreeningStage,
): CandidateSuggestion | null {
  const own = member.suggestions?.[stage];
  if (own || stage !== 'title-abstract') return own ?? null;
  return (
    corpus.deep?.candidates.find((item) => item.suggestion && sameRecord(item, member))?.suggestion ?? null
  );
}

/** The AI suggestion for a member at a stage, as a decision. Shown apart, never counted. */
export function suggestionFor(
  corpus: Corpus,
  member: CorpusMember,
  stage: ScreeningStage = 'title-abstract',
): AiSuggestion | undefined {
  const suggestion = memberSuggestion(corpus, member, stage);
  if (!suggestion) return undefined;
  const decision = { included: 'include', excluded: 'exclude', uncertain: 'uncertain' } as const;
  return { decision: decision[suggestion.decision], reason: suggestion.reason };
}

export type DecisionInput = {
  stage: ScreeningStage;
  decision: ScreeningDecision;
  reasonCode?: ScreeningReasonCode | '';
  reasonText?: string;
  person: string;
  /** Set when the person accepts an AI suggestion; the decision is still theirs. */
  acceptedSuggestion?: AiSuggestion;
};
export type DecisionError =
  | 'unknown-member'
  | 'person-required'
  | 'reason-required'
  | 'reason-text-required'
  | 'full-text-before-include'
  | 'suggestion-mismatch';
export type DecisionResult = { ok: true; corpus: Corpus } | { ok: false; error: DecisionError };

/** Appends one person decision to a member's log, after the checks every screening path shares. */
export function recordDecision(
  corpus: Corpus,
  memberId: string,
  input: DecisionInput,
  at: string,
): DecisionResult {
  const member = corpus.members.find((item) => item.memberId === memberId);
  if (!member) return { ok: false, error: 'unknown-member' };
  const person = input.person.trim();
  if (!person) return { ok: false, error: 'person-required' };
  const reasonText = (input.reasonText ?? '').trim();
  const reasonCode = input.decision === 'exclude' ? (input.reasonCode ?? '') : '';
  if (input.decision === 'exclude' && !reasonCode) return { ok: false, error: 'reason-required' };
  if (reasonCode === 'other' && !reasonText) return { ok: false, error: 'reason-text-required' };
  if (input.stage === 'full-text' && !canScreenFullText(member))
    return { ok: false, error: 'full-text-before-include' };
  if (input.acceptedSuggestion && input.acceptedSuggestion.decision !== input.decision)
    return { ok: false, error: 'suggestion-mismatch' };
  const decision: CorpusDecision = {
    stage: input.stage,
    decision: input.decision,
    reasonCode,
    reasonText,
    decider: { kind: 'person', name: person },
    ...(input.acceptedSuggestion ? { acceptedSuggestion: input.acceptedSuggestion } : {}),
    at,
  };
  return {
    ok: true,
    corpus: {
      ...corpus,
      updatedAt: at,
      members: corpus.members.map((item) =>
        item.memberId === memberId ? { ...item, decisions: [...item.decisions, decision] } : item,
      ),
    },
  };
}
