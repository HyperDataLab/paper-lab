import type { Analysis } from '../schemas/analysis';
import type { DimensionId } from './rubric';

export type Availability = Record<DimensionId, { applicable: boolean; reason: string | null }>;
export function assessability(
  analysis: Pick<Analysis, 'text' | 'sentenceAnnotations' | 'paragraph' | 'flowLinks'>,
): Availability {
  const syntax =
    analysis.text.sentences.length > 0 &&
    analysis.text.sentences.every((sentence) =>
      analysis.sentenceAnnotations.some((annotation) => annotation.sentenceId === sentence.id),
    );
  const split = analysis.text.sentences.length > 0;
  const paragraph = !!analysis.paragraph;
  const flowReason = !paragraph
    ? 'Cần phân tích cấu trúc đoạn'
    : analysis.text.sentences.length < 2
      ? 'Đoạn chỉ có một câu'
      : !analysis.flowLinks.some((link) => link.measured)
        ? 'Cần ít nhất một cặp câu được đo'
        : null;
  return {
    sentence_structure: { applicable: syntax, reason: syntax ? null : 'Cần phân tích câu' },
    verb_word_choice: { applicable: split, reason: split ? null : 'Cần tách câu' },
    concision_modifiers: { applicable: split, reason: split ? null : 'Cần tách câu' },
    paragraph_organization: {
      applicable: paragraph,
      reason: paragraph ? null : 'Cần phân tích cấu trúc đoạn',
    },
    flow_coherence: { applicable: !flowReason, reason: flowReason },
  };
}
