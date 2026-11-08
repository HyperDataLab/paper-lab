import { z } from 'zod';
import { ScoresSchema } from './scores';
import { CalibrationSnapshotSchema } from './calibration';

const MetricSchema = z.object({
  meanDelta: z.number().nullable(),
  meanAbsDelta: z.number().nonnegative().nullable(),
  meanNoise: z.number().nonnegative().nullable(),
  n: z.number().int().nonnegative(),
});
export const ProbeSummarySchema = z.object({
  overall: MetricSchema,
  dimensions: z.record(z.string(), MetricSchema),
  verdict: z.enum(['insufficient', 'style_sensitive', 'stable']),
});
export const ProbeItemSchema = z.object({
  paragraphId: z.string(),
  sectionId: z.string(),
  textHash: z.string(),
  analysisId: z.uuid(),
  rewrittenText: z.string(),
  reasons: z.array(z.string()),
  original: ScoresSchema.nullable(),
  rewritten: ScoresSchema.nullable(),
  baseline: ScoresSchema.nullable(),
});
export const PaperProbeRunSchema = z.object({
  calibrationSnapshot: CalibrationSnapshotSchema.nullable().optional(),
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  n: z.number().int().min(3).max(10),
  promptVersions: z.record(z.string(), z.string()),
  model: z.string(),
  paragraphIds: z.array(z.string()),
  analysisIds: z.array(z.uuid()),
  analysisUpdatedAt: z.array(z.iso.datetime()),
  preserveTerms: z.record(z.string(), z.array(z.string())),
  budget: z.number().int().nonnegative(),
  callsUsed: z.number().int().nonnegative(),
  status: z.enum(['running', 'cancelled', 'budget_exceeded', 'failed', 'done']),
  items: z.array(ProbeItemSchema),
  summary: ProbeSummarySchema,
});
export const PaperProbesRecordSchema = z.object({
  schemaVersion: z.literal(1),
  paperId: z.uuid(),
  updatedAt: z.iso.datetime(),
  runs: z.array(PaperProbeRunSchema),
});
export type ProbeItemRecord = z.infer<typeof ProbeItemSchema>;
export type PaperProbeRun = z.infer<typeof PaperProbeRunSchema>;
export type PaperProbesRecord = z.infer<typeof PaperProbesRecordSchema>;
