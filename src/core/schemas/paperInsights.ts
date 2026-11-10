import { z } from 'zod';

export const RHETORIC_CATEGORIES = [
  'territory',
  'niche',
  'occupy',
  'result_statement',
  'comparison',
  'explanation',
  'limitation',
  'implication',
  'threat_internal',
  'threat_external',
  'threat_construct',
  'threat_conclusion',
  'data_availability',
  'code_availability',
] as const;
export const RhetoricCategorySchema = z.enum(RHETORIC_CATEGORIES);
export type RhetoricCategory = z.infer<typeof RhetoricCategorySchema>;

export const RhetoricOutputSchema = z.object({
  items: z.array(
    z.object({
      paragraphId: z.string(),
      quote: z.string(),
      category: RhetoricCategorySchema,
      rationale: z.string(),
    }),
  ),
});
export type RhetoricOutput = z.infer<typeof RhetoricOutputSchema>;

export const AbstractAlignmentOutputSchema = z.object({
  claims: z.array(
    z.object({
      abstractParagraphId: z.string(),
      abstractQuote: z.string(),
      supportParagraphId: z.string().nullable(),
      supportQuote: z.string().nullable(),
      rationale: z.string(),
    }),
  ),
});
export type AbstractAlignmentOutput = z.infer<typeof AbstractAlignmentOutputSchema>;

const SpanSchema = z.object({
  paragraphId: z.string(),
  sectionId: z.string(),
  page: z.number().int().nullable(),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  excerpt: z.string(),
});
export const RhetoricItemSchema = SpanSchema.extend({
  id: z.string(),
  category: RhetoricCategorySchema,
  rationale: z.string(),
});
export const AbstractClaimSchema = z.object({
  id: z.string(),
  claim: SpanSchema,
  /** Null means the model found no support in the text it was shown, not that none exists. */
  support: SpanSchema.nullable(),
  rationale: z.string(),
});
export const RhetoricRunSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  model: z.string(),
  promptVersion: z.string(),
  callsUsed: z.number().int().nonnegative(),
  sectionIds: z.array(z.string()),
  failedSectionIds: z.array(z.string()),
  items: z.array(RhetoricItemSchema),
  abstractClaims: z.array(AbstractClaimSchema),
  /** False when the abstract, or the text to compare it with, could not be read. */
  abstractChecked: z.boolean(),
  discarded: z.object({
    not_found: z.number().int().nonnegative(),
    duplicate: z.number().int().nonnegative(),
  }),
});
const RefSchema = z.object({ paragraphId: z.string(), quote: z.string() });
export const ArgumentOutputSchema = z.object({
  arguments: z.array(
    z.object({
      claim: RefSchema,
      importance: z.enum(['main', 'supporting']),
      data: z.array(RefSchema),
      statedWarrant: RefSchema.nullable(),
      /** The analyst's reading when the authors state no warrant. Never presented as theirs. */
      inferredWarrant: z.string().nullable(),
      backing: z.array(RefSchema),
      qualifier: RefSchema.nullable(),
      rebuttals: z.array(RefSchema),
    }),
  ),
});
export type ArgumentOutput = z.infer<typeof ArgumentOutputSchema>;
export const ArgumentSchema = z.object({
  id: z.string(),
  importance: z.enum(['main', 'supporting']),
  claim: SpanSchema,
  data: z.array(SpanSchema),
  statedWarrant: SpanSchema.nullable(),
  inferredWarrant: z.string().nullable(),
  backing: z.array(SpanSchema),
  qualifier: SpanSchema.nullable(),
  rebuttals: z.array(SpanSchema),
});
export const ArgumentRunSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  model: z.string(),
  promptVersion: z.string(),
  callsUsed: z.number().int().nonnegative(),
  sectionIds: z.array(z.string()),
  failedSectionIds: z.array(z.string()),
  arguments: z.array(ArgumentSchema),
  discarded: z.object({
    claim_not_found: z.number().int().nonnegative(),
    element_not_found: z.number().int().nonnegative(),
    duplicate: z.number().int().nonnegative(),
  }),
});
export const ArgumentPendingSchema = z.object({
  sectionIds: z.array(z.string()),
  callsUsed: z.number().int().nonnegative(),
  model: z.string().nullable(),
  chunks: z.record(z.string(), ArgumentOutputSchema),
});
export const InsightDecisionSchema = z.object({
  run_id: z.uuid(),
  item_id: z.string(),
  decision: z.enum(['confirm', 'dismiss', 'reopen']),
  at: z.iso.datetime(),
});
export const RhetoricPendingSchema = z.object({
  sectionIds: z.array(z.string()),
  callsUsed: z.number().int().nonnegative(),
  model: z.string().nullable(),
  chunks: z.record(z.string(), RhetoricOutputSchema),
  alignment: AbstractAlignmentOutputSchema.nullable(),
});
export const PaperInsightsRecordSchema = z.object({
  schemaVersion: z.literal(1),
  paperId: z.uuid(),
  updatedAt: z.iso.datetime(),
  rhetoricRuns: z.array(RhetoricRunSchema),
  rhetoricPending: RhetoricPendingSchema.nullable(),
  argumentRuns: z.array(ArgumentRunSchema).default([]),
  argumentPending: ArgumentPendingSchema.nullable().default(null),
  decisions: z.array(InsightDecisionSchema),
});
export type RhetoricItem = z.infer<typeof RhetoricItemSchema>;
export type AbstractClaim = z.infer<typeof AbstractClaimSchema>;
export type RhetoricRun = z.infer<typeof RhetoricRunSchema>;
export type RhetoricPending = z.infer<typeof RhetoricPendingSchema>;
export type InsightDecision = z.infer<typeof InsightDecisionSchema>;
export type PaperInsightsRecord = z.infer<typeof PaperInsightsRecordSchema>;
export type Argument = z.infer<typeof ArgumentSchema>;
export type ArgumentRun = z.infer<typeof ArgumentRunSchema>;
export type ArgumentPending = z.infer<typeof ArgumentPendingSchema>;
