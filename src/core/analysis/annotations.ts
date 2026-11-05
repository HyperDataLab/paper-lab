import type { SentenceAnnotation } from '../schemas/analysis';
import type { TextAnalysis } from '../schemas/text';
import { computeSentenceMetrics } from './metrics';
import type { SentenceSyntax } from './syntaxTypes';

/** Merges validated syntax with deterministic metrics into storable annotations (one per sentence). */
export function buildSentenceAnnotations(text: TextAnalysis, syntax: SentenceSyntax[]): SentenceAnnotation[] {
  const byId = new Map(syntax.map((entry) => [entry.sentenceId, entry]));
  return text.sentences.flatMap((sentence) => {
    const entry = byId.get(sentence.id);
    if (!entry) return [];
    const m = computeSentenceMetrics(entry, sentence, text.tokens);
    return [
      {
        sentenceId: sentence.id,
        topicSpan: m.topicSpan,
        actionSpan: m.actionSpan,
        stressSpan: m.stressSpan,
        role: null,
        subjectVerbDistanceTokens: m.subjectVerbDistanceTokens,
        parseConfidence: entry.confidence,
        subjectSpan: m.subjectSpan,
        verbSpan: m.verbSpan,
        interveningSpan: m.interveningSpan,
        subjectHeadTokenIndex: entry.subjectHead,
        verbHeadTokenIndex: entry.mainVerbHead,
        voice: entry.voice,
        clauseCount: entry.clauseCount,
        maxClauseDepth: entry.maxClauseDepth,
        preTopicTokens: m.preTopicTokens,
        topicPositionRatio: m.topicPositionRatio,
        stressEndDistance: m.stressEndDistance,
        unresolved: [...entry.unresolved, ...m.reasons],
      },
    ];
  });
}
