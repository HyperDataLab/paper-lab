import type { ParagraphStructureOutput } from '../prompts/paragraphStructure';
import type { SentenceAnnotation } from '../schemas/analysis';
import { STRUCTURE_TYPES, type FlowLink, type Paragraph } from '../schemas/paragraph';
import type { TextAnalysis } from '../schemas/text';

export function validateParagraphStructure(
  raw: ParagraphStructureOutput,
  text: TextAnalysis,
  annotations: SentenceAnnotation[],
) {
  const ids = new Set(text.sentences.map((sentence) => sentence.id));
  const roles = text.sentences.map((sentence) => {
    const role = raw.roles.find((item) => item.sentenceId === sentence.id);
    return {
      sentenceId: sentence.id,
      role: role?.role ?? ('unknown' as const),
      confidence: role?.confidence ?? null,
      rationale: role?.rationale ?? null,
    };
  });
  const centralSentence = text.sentences.find((sentence) => sentence.id === raw.centralPointSentenceId);
  const topScore = Math.max(...Object.values(raw.typeScores));
  const type = STRUCTURE_TYPES.find((item) => item === raw.type);
  const chosenScore = type ? raw.typeScores[type] : 0;
  const acceptedType = type && chosenScore >= 0.4 && topScore - chosenScore <= 0.2 ? type : 'UNKNOWN';
  const paragraph: Paragraph = {
    type: acceptedType,
    confidence: acceptedType === 'UNKNOWN' ? (raw.typeScores.UNKNOWN ?? topScore) : chosenScore,
    typeScores: raw.typeScores,
    centralPoint: {
      sentenceId: centralSentence?.id ?? null,
      span: centralSentence ? { start: centralSentence.start, end: centralSentence.end } : null,
      identifiability: raw.identifiability,
      evidence: raw.evidence,
    },
    unity: {
      offTopicSentenceIds: [...new Set(raw.offTopicSentenceIds.filter((id) => ids.has(id)))],
      rationale: raw.unityRationale,
    },
    rationale: raw.rationale,
  };
  const flowLinks: FlowLink[] = text.sentences.slice(0, -1).flatMap((from, i) => {
    const to = text.sentences[i + 1];
    if (!to) return [];
    const pair = raw.pairs.find((item) => item.fromSentenceId === from.id && item.toSentenceId === to.id);
    return [
      {
        fromSentenceId: from.id,
        toSentenceId: to.id,
        continuity: pair?.continuity ?? 'shift',
        discourseRelation: pair?.discourseRelation ?? 'none',
        linked: pair?.linked ?? false,
        measured: !!pair,
        confidence: pair?.confidence ?? 0,
        rationale: pair?.rationale ?? 'no model output',
        fromSpan: annotations.find((item) => item.sentenceId === from.id)?.stressSpan ?? null,
        toSpan: annotations.find((item) => item.sentenceId === to.id)?.topicSpan ?? null,
      },
    ];
  });
  return { paragraph, roles, flowLinks };
}
