import { z } from 'zod';

export const STANCE_CATEGORIES = ['hedges', 'boosters', 'attitude_markers', 'self_mention'] as const;
export const ENGAGEMENT_CATEGORIES = [
  'reader_pronouns',
  'directives',
  'questions',
  'knowledge_reference',
  'asides',
] as const;
export const StanceCategorySchema = z.enum([...STANCE_CATEGORIES, ...ENGAGEMENT_CATEGORIES]);
export type StanceCategory = z.infer<typeof StanceCategorySchema>;

// Model output. It gives text; code finds where that text is.
export const StanceOutputSchema = z.object({
  annotations: z.array(
    z.object({
      paragraphId: z.string(),
      quote: z.string(),
      marker: z.string(),
      category: StanceCategorySchema,
      rationale: z.string(),
    }),
  ),
});
export type StanceOutput = z.infer<typeof StanceOutputSchema>;

export const StanceAnnotationSchema = z.object({
  id: z.string(),
  paragraphId: z.string(),
  sectionId: z.string(),
  page: z.number().int().positive().nullable(),
  category: StanceCategorySchema,
  marker: z.string(),
  /** Code-point span of the marker in the paragraph, computed by code. */
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  excerpt: z.string(),
  rationale: z.string(),
});
export const StanceRunSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  model: z.string(),
  promptVersion: z.string(),
  callsUsed: z.number().int().nonnegative(),
  sectionIds: z.array(z.string()),
  /** Words per section, only for text the model actually read; these are the denominators. */
  words: z.record(z.string(), z.number().int().nonnegative()),
  failedSectionIds: z.array(z.string()),
  annotations: z.array(StanceAnnotationSchema),
  discarded: z.object({
    not_found: z.number().int().nonnegative(),
    wrong_form: z.number().int().nonnegative(),
    duplicate: z.number().int().nonnegative(),
  }),
});
export const StanceDecisionSchema = z.object({
  run_id: z.uuid(),
  annotation_id: z.string(),
  decision: z.enum(['confirm', 'dismiss', 'reopen']),
  at: z.iso.datetime(),
});
export const StancePendingSchema = z.object({
  sectionIds: z.array(z.string()),
  callsUsed: z.number().int().nonnegative(),
  model: z.string().nullable(),
  chunks: z.record(z.string(), StanceOutputSchema),
});
export const StanceRecordSchema = z.object({
  schemaVersion: z.literal(1),
  paperId: z.uuid(),
  updatedAt: z.iso.datetime(),
  runs: z.array(StanceRunSchema),
  decisions: z.array(StanceDecisionSchema),
  pending: StancePendingSchema.nullable(),
});
export type StanceAnnotation = z.infer<typeof StanceAnnotationSchema>;
export type StanceRun = z.infer<typeof StanceRunSchema>;
export type StanceDecision = z.infer<typeof StanceDecisionSchema>;
export type StancePending = z.infer<typeof StancePendingSchema>;
export type StanceRecord = z.infer<typeof StanceRecordSchema>;
