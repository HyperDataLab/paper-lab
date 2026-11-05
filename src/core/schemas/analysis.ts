import { z } from 'zod';
import { TextAnalysisSchema } from './text';
import { SpanSchema } from './span';
import { IssueSchema } from './issue';
const nullableNumber = z.number().nullable().default(null);
// Fields after parseConfidence were added in S5; defaults keep S3-era records parseable (schemaVersion 1).
export const SentenceAnnotationSchema = z.object({
  sentenceId: z.string(),
  topicSpan: SpanSchema.nullable(),
  actionSpan: SpanSchema.nullable(),
  stressSpan: SpanSchema.nullable(),
  role: z.string().nullable(),
  subjectVerbDistanceTokens: z.number().nullable(),
  parseConfidence: z.number().min(0).max(1).nullable(),
  subjectSpan: SpanSchema.nullable().default(null),
  verbSpan: SpanSchema.nullable().default(null),
  interveningSpan: SpanSchema.nullable().default(null),
  subjectHeadTokenIndex: z.number().int().nonnegative().nullable().default(null),
  verbHeadTokenIndex: z.number().int().nonnegative().nullable().default(null),
  voice: z.enum(['active', 'passive']).nullable().default(null),
  clauseCount: nullableNumber,
  maxClauseDepth: nullableNumber,
  preTopicTokens: nullableNumber,
  topicPositionRatio: nullableNumber,
  stressEndDistance: nullableNumber,
  unresolved: z.array(z.string()).default([]),
});
export type SentenceAnnotation = z.infer<typeof SentenceAnnotationSchema>;
export const AnalysisSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  title: z.string().optional(),
  text: TextAnalysisSchema,
  context: z.object({
    before: z.string().nullable(),
    after: z.string().nullable(),
    audience: z.enum(['specialist', 'general', 'student']).nullable(),
  }),
  contextLimited: z.boolean(),
  versions: z.object({
    rubric: z.string().nullable(),
    prompt: z.string().nullable(),
    model: z.string().nullable(),
    syntaxProvider: z.string().nullable(),
  }),
  sentenceAnnotations: z.array(SentenceAnnotationSchema),
  issues: z.array(IssueSchema),
  parentAnalysisId: z.uuid().nullable(),
});
export type Analysis = z.infer<typeof AnalysisSchema>;
/** Shape accepted before defaults are applied (e.g. records written before S5). */
export type AnalysisInput = z.input<typeof AnalysisSchema>;
