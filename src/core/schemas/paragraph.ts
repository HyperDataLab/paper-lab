import { z } from 'zod';
import { SpanSchema } from './span';

export const SENTENCE_ROLES = [
  'topic_sentence',
  'development',
  'lead',
  'resolution',
  'opening',
  'challenge',
  'action',
  'transition',
  'off_topic',
  'unknown',
] as const;
export const STRUCTURE_TYPES = ['TS-D', 'LD', 'LDR', 'OCAR', 'UNKNOWN'] as const;
export const CONTINUITIES = ['stress_to_topic', 'topic_to_topic', 'derived', 'shift'] as const;
export const RELATIONS = [
  'elaboration',
  'cause',
  'contrast',
  'example',
  'sequence',
  'restatement',
  'other',
  'none',
] as const;
const confidence = z.number().min(0).max(1);
export const ParagraphSchema = z.object({
  type: z.enum(STRUCTURE_TYPES),
  confidence,
  typeScores: z.record(z.enum(STRUCTURE_TYPES), confidence),
  centralPoint: z.object({
    sentenceId: z.string().nullable(),
    span: SpanSchema.nullable(),
    identifiability: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    evidence: z.string(),
  }),
  unity: z.object({ offTopicSentenceIds: z.array(z.string()), rationale: z.string() }),
  rationale: z.string(),
});
export const FlowLinkSchema = z.object({
  fromSentenceId: z.string(),
  toSentenceId: z.string(),
  continuity: z.enum(CONTINUITIES),
  discourseRelation: z.enum(RELATIONS),
  linked: z.boolean(),
  measured: z.boolean().default(true),
  confidence,
  fromSpan: SpanSchema.nullable(),
  toSpan: SpanSchema.nullable(),
  rationale: z.string(),
});
const fraction = z.object({
  numerator: z.number().nonnegative(),
  denominator: z.number().nonnegative(),
  value: z.number().nullable(),
});
export const ParagraphMetricsSchema = z.object({
  sentence_role_coverage: fraction,
  off_topic_sentence_count: fraction,
  stress_to_next_topic_alignment: fraction,
  unexplained_topic_shift_count: fraction,
  discourse_relation_coverage: fraction,
  topic_continuity_pattern: z.record(z.enum(CONTINUITIES), fraction),
  central_point_identifiability: fraction,
});
export type Paragraph = z.infer<typeof ParagraphSchema>;
export type FlowLink = z.infer<typeof FlowLinkSchema>;
export type ParagraphMetrics = z.infer<typeof ParagraphMetricsSchema>;
