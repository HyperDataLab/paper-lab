import type { Span } from '../schemas/span';
import type { Sentence, Token } from '../schemas/text';
import { isPunctuation } from '../text/tokenize';
import type { SentenceSyntax, TokenRange } from './syntaxTypes';

export type SentenceMetrics = {
  subjectSpan: Span | null;
  verbSpan: Span | null;
  topicSpan: Span | null;
  actionSpan: Span | null;
  stressSpan: Span | null;
  interveningSpan: Span | null;
  subjectVerbDistanceTokens: number | null;
  preTopicTokens: number | null;
  topicPositionRatio: number | null;
  stressEndDistance: number | null;
  reasons: string[];
};

function spanOf(range: TokenRange | null, tokens: Token[]): Span | null {
  if (!range) return null;
  const first = tokens[range.start];
  const last = tokens[range.end - 1];
  return first && last ? { start: first.start, end: last.end } : null;
}

/** Indexes in [from, to) whose token is not punctuation (PRD §4: distances exclude punctuation). */
function contentIndexes(tokens: Token[], from: number, to: number): number[] {
  const result: number[] = [];
  for (let i = from; i < to; i++) {
    const token = tokens[i];
    if (token && !isPunctuation(token)) result.push(i);
  }
  return result;
}

/** Deterministic metrics from validated token ranges; never from model-supplied offsets. */
export function computeSentenceMetrics(
  syntax: SentenceSyntax,
  sentence: Sentence,
  tokens: Token[],
): SentenceMetrics {
  const reasons: string[] = [];
  const { subject, mainVerb, topic, stress } = syntax;
  let distance: number | null = null;
  let intervening: Span | null = null;
  if (subject && mainVerb) {
    if (mainVerb.end <= subject.start) reasons.push('subjectVerbDistance: atypical order');
    else if (mainVerb.start < subject.end) reasons.push('subjectVerbDistance: overlap');
    else {
      const between = contentIndexes(tokens, subject.end, mainVerb.start);
      distance = between.length;
      const first = between[0];
      const last = between.at(-1);
      if (first !== undefined && last !== undefined)
        intervening = spanOf({ start: first, end: last + 1 }, tokens);
    }
  }
  const topicSpan = spanOf(topic, tokens);
  const length = sentence.end - sentence.start;
  return {
    subjectSpan: spanOf(subject, tokens),
    verbSpan: spanOf(mainVerb, tokens),
    topicSpan,
    actionSpan: spanOf(syntax.action, tokens),
    stressSpan: spanOf(stress, tokens),
    interveningSpan: intervening,
    subjectVerbDistanceTokens: distance,
    preTopicTokens: topic ? contentIndexes(tokens, sentence.tokenStart, topic.start).length : null,
    topicPositionRatio:
      topicSpan && length > 0
        ? Math.round(((topicSpan.start - sentence.start) / length) * 1000) / 1000
        : null,
    stressEndDistance: stress ? contentIndexes(tokens, stress.end, sentence.tokenEnd).length : null,
    reasons,
  };
}
