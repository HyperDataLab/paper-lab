import { z } from 'zod';
import { CalibrationSnapshotSchema } from './calibration';

export const BatchStepSchema = z.enum(['syntax', 'judge', 'structure', 'score', 'transitions']);
export const RunPlanSchema = z.object({
  sectionIds: z.array(z.string()),
  steps: z.array(BatchStepSchema),
  budget: z.number().int().nonnegative(),
  paragraphs: z.array(z.object({ paragraphId: z.string(), sectionId: z.string(), textHash: z.string() })),
  skipped: z.array(z.object({ paragraphId: z.string(), reason: z.string() })),
  calls: z.object({
    syntax: z.number().int().nonnegative(),
    judge: z.number().int().nonnegative(),
    structure: z.number().int().nonnegative(),
    score: z.number().int().nonnegative(),
    transitions: z.number().int().nonnegative().optional(),
  }),
  total: z.number().int().nonnegative(),
  withinBudget: z.boolean(),
});
export const PaperRunSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  paperId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  status: z.enum(['idle', 'running', 'paused', 'cancelled', 'done', 'budget_exceeded', 'failed']),
  plan: RunPlanSchema,
  budget: z.number().int().nonnegative(),
  callsUsed: z.number().int().nonnegative(),
  callsByStep: z.record(z.string(), z.number().int().nonnegative()).nullable().optional(),
  calibrationSnapshots: z.record(z.string(), CalibrationSnapshotSchema).nullable().optional(),
  promptVersions: z.record(z.string(), z.string()),
  model: z.string(),
  transitionDone: z.array(z.string()).optional(),
  items: z.array(
    z.object({
      paragraphId: z.string(),
      textHash: z.string(),
      analysisId: z.uuid().nullable(),
      status: z.enum(['pending', 'running', 'done', 'failed', 'skipped', 'cached']),
      stepsDone: z.array(BatchStepSchema),
      calls: z.number().int().nonnegative(),
      error: z.string().nullable(),
    }),
  ),
});
export type BatchStep = z.infer<typeof BatchStepSchema>;
export type RunPlan = z.infer<typeof RunPlanSchema>;
export type PaperRun = z.infer<typeof PaperRunSchema>;
