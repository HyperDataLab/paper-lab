import type { FlowLink, Paragraph, ParagraphMetrics } from '../schemas/paragraph';
import { CONTINUITIES } from '../schemas/paragraph';
import { hasNamedRelation, isUnexplainedShift } from './issues';

export function computeParagraphMetrics(
  paragraph: Paragraph,
  roles: { role: string; rationale: string | null }[],
  links: FlowLink[],
): ParagraphMetrics {
  const fraction = (numerator: number, denominator: number) => ({
    numerator,
    denominator,
    value: denominator ? Math.round((numerator / denominator) * 1000) / 1000 : null,
  });
  const measured = links.filter((link) => link.measured);
  const analysable = measured.filter((link) => link.fromSpan && link.toSpan);
  const patterns = Object.fromEntries(
    CONTINUITIES.map((continuity) => [
      continuity,
      fraction(measured.filter((link) => link.continuity === continuity).length, measured.length),
    ]),
  ) as ParagraphMetrics['topic_continuity_pattern'];
  return {
    sentence_role_coverage: fraction(
      roles.filter((role) => role.role !== 'unknown' && !!role.rationale?.trim()).length,
      roles.length,
    ),
    off_topic_sentence_count: fraction(paragraph.unity.offTopicSentenceIds.length, roles.length),
    stress_to_next_topic_alignment: fraction(
      analysable.filter((link) => link.linked && link.continuity === 'stress_to_topic').length,
      analysable.length,
    ),
    unexplained_topic_shift_count: fraction(measured.filter(isUnexplainedShift).length, measured.length),
    discourse_relation_coverage: fraction(measured.filter(hasNamedRelation).length, measured.length),
    topic_continuity_pattern: patterns,
    central_point_identifiability: fraction(paragraph.centralPoint.identifiability, 4),
  };
}
