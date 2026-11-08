import { z } from 'zod';
import { CONTINUITIES, RELATIONS, STRUCTURE_TYPES } from './paragraph';
import { SpanSchema } from './span';

const distribution = z.object({
  n: z.number().int().positive(),
  median: z.number(),
  q1: z.number(),
  q3: z.number(),
  min: z.number(),
  max: z.number(),
});
const counts = z.object({
  bodyParagraphs: z.number().int().nonnegative(),
  analysed: z.number().int().nonnegative(),
  coverage: z.number().min(0).max(1),
  issuesByCategory: z.record(z.string(), z.number().int().nonnegative()),
  issuesByType: z.record(z.string(), z.number().int().nonnegative()),
  scores: z.record(z.string(), distribution.nullable()),
  structures: z.record(z.enum(STRUCTURE_TYPES), z.number().int().nonnegative()),
});
export const PaperOverviewSchema = counts.extend({
  schemaVersion: z.literal(1),
  paperId: z.uuid(),
  sections: z.array(counts.extend({ sectionId: z.string() })),
  recurringIssues: z.array(
    z.object({
      type: z.string(),
      paragraphIds: z.array(z.string()),
      sectionIds: z.array(z.string()),
      count: z.number(),
      examples: z.array(z.string()).max(3),
    }),
  ),
  generatedFrom: z.array(
    z.object({
      analysisId: z.uuid(),
      updatedAt: z.iso.datetime(),
      promptVersions: z.array(z.string()),
      rubricVersions: z.array(z.string()),
    }),
  ),
});
export const TransitionEndpointSchema = z.object({
  paragraphId: z.string(),
  analysisId: z.uuid(),
  span: SpanSchema,
  quote: z.string(),
  sentence: z.string(),
  analysisUpdatedAt: z.iso.datetime().optional(),
});
export const TransitionPairSchema = z.object({
  pairId: z.string(),
  sectionId: z.string(),
  sectionRole: z.string(),
  from: TransitionEndpointSchema,
  to: TransitionEndpointSchema,
});
export const TransitionJudgementSchema = z.object({
  pairId: z.string(),
  continuity: z.enum(CONTINUITIES),
  discourseRelation: z.enum(RELATIONS),
  linked: z.boolean(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  measured: z.boolean(),
  judgedAt: z.iso.datetime().optional(),
  available: z.boolean().optional(),
  stale: z.boolean().optional(),
});
export const TransitionFindingSchema = z.object({
  id: z.string(),
  type: z.enum(['FLOW_BREAK_CANDIDATE', 'UNEXPLAINED_TOPIC_SHIFT']),
  pairId: z.string(),
  from: TransitionEndpointSchema.pick({ paragraphId: true, analysisId: true, span: true }),
  to: TransitionEndpointSchema.pick({ paragraphId: true, analysisId: true, span: true }),
  severity: z.enum(['moderate', 'minor']),
  status: z.enum(['candidate', 'confirmed_by_model', 'confirmed_by_human', 'dismissed_by_human']),
  why: z.string(),
  suggestedFix: z.string(),
  confidence: z.number().min(0).max(1),
});
export const PaperOverviewRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    paperId: z.uuid(),
    overview: PaperOverviewSchema,
    transitions: z
      .object({
        pairs: z.array(TransitionPairSchema),
        judgements: z.array(TransitionJudgementSchema),
        findings: z.array(TransitionFindingSchema),
        promptVersion: z.string(),
        model: z.string(),
        updatedAt: z.iso.datetime(),
        stale: z.boolean().optional(),
      })
      .nullable(),
  })
  .refine((record) => record.paperId === record.overview.paperId);
export type PaperOverview = z.infer<typeof PaperOverviewSchema>;
export type TransitionPair = z.infer<typeof TransitionPairSchema>;
export type TransitionJudgement = z.infer<typeof TransitionJudgementSchema>;
export type TransitionFinding = z.infer<typeof TransitionFindingSchema>;
export type PaperOverviewRecord = z.infer<typeof PaperOverviewRecordSchema>;
