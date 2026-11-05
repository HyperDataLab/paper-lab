import { z } from 'zod';
import { TextAnalysisSchema } from './text';
import { SpanSchema } from './span';
import { IssueSchema } from './issue';
export const SentenceAnnotationSchema = z.object({
  sentenceId: z.string(),
  topicSpan: SpanSchema.nullable(),
  actionSpan: SpanSchema.nullable(),
  stressSpan: SpanSchema.nullable(),
  role: z.string().nullable(),
  subjectVerbDistanceTokens: z.number().nullable(),
  parseConfidence: z.number().min(0).max(1).nullable(),
});
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
