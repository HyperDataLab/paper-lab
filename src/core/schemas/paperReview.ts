import { z } from 'zod';
import { LensSchema, PaperReviewOutputSchema, ReviewPointSchema } from '../prompts/paperReview';
import { CalibrationSnapshotSchema } from './calibration';

const AnchorSchema = z
  .object({
    paragraphId: z.string(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .refine((value) => value.end > value.start);
export const AnchoredReviewPointSchema = ReviewPointSchema.extend({ lens: LensSchema, anchor: AnchorSchema });
export const AnchoredReviewSchema = PaperReviewOutputSchema.extend({
  points: z.array(AnchoredReviewPointSchema),
});
export const MergedReviewPointSchema = z.object({
  id: z.string(),
  lenses: z.array(LensSchema).min(1),
  anchor: AnchorSchema,
  severity: z.enum(['minor', 'moderate', 'major']),
  wordings: z.array(AnchoredReviewPointSchema).min(1),
});
export const HumanNotesSchema = z.object({
  paperId: z.uuid(),
  text: z.string(),
  writtenAt: z.iso.datetime(),
  revealedAt: z.iso.datetime().nullable(),
});
export const ReviewDecisionSchema = z.object({
  pointId: z.string(),
  status: z.enum(['confirmed_by_human', 'dismissed_by_human']),
  note: z.string(),
  at: z.iso.datetime(),
});
export const PaperReviewRunSchema = z.object({
  calibrationSnapshot: CalibrationSnapshotSchema.nullable().optional(),
  callsUsed: z.number().int().nonnegative().nullable().optional(),
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  lenses: z.array(LensSchema),
  sectionIds: z.array(z.string()),
  promptVersion: z.string(),
  model: z.string(),
  reviews: z.array(AnchoredReviewSchema),
  merged: z.array(MergedReviewPointSchema),
  metrics: z.object({
    anchoring: z.object({
      anchored: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      rate: z.number().min(0).max(1).nullable(),
    }),
    similarity: z.object({
      matrix: z.array(z.array(z.number())),
      mean: z.number().nullable(),
      similarPairs: z.array(z.object({ lenses: z.tuple([z.string(), z.string()]), similarity: z.number() })),
    }),
    templates: z.array(z.object({ phrase: z.string(), hash: z.string() })),
    agreement: z.object({ matching: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  }),
});
export const PaperReviewsRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    paperId: z.uuid(),
    updatedAt: z.iso.datetime(),
    runs: z.array(PaperReviewRunSchema),
    humanNotes: HumanNotesSchema.nullable(),
    decisions: z.array(ReviewDecisionSchema),
  })
  .refine((v) => !v.humanNotes || v.humanNotes.paperId === v.paperId);
export const ReviewNgramSchema = z.object({
  hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  paperId: z.uuid(),
});
export type PaperReviewRun = z.infer<typeof PaperReviewRunSchema>;
export type PaperReviewsRecord = z.infer<typeof PaperReviewsRecordSchema>;
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;
