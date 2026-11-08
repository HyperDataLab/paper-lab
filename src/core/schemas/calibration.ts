import { z } from 'zod';

const findingTarget = z.object({
  kind: z.enum(['issue', 'check', 'point']),
  type: z.string().min(1),
  textHash: z.string().min(1),
  quote: z.string().min(1),
});
const scoreTarget = z.object({
  kind: z.literal('score'),
  dimension: z.string().min(1),
  textHash: z.string().min(1),
});
export const CalibrationLabelSchema = z.union([
  z.object({
    rater: z.string().min(1),
    target: findingTarget,
    label: z.enum(['correct', 'incorrect']),
    note: z.string().optional(),
  }),
  z.object({
    rater: z.string().min(1),
    target: scoreTarget,
    label: z.number().int().min(0).max(4),
    note: z.string().optional(),
  }),
]);
export const CalibrationLabelsSchema = z.object({
  format: z.literal('paragraph-lab-labels'),
  version: z.literal(1),
  labels: z.array(CalibrationLabelSchema),
});
export const CalibrationLabelSetSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  sourceFileName: z.string().min(1),
  importedAt: z.iso.datetime(),
  data: CalibrationLabelsSchema,
});
export type CalibrationLabel = z.infer<typeof CalibrationLabelSchema>;
export type CalibrationLabelSet = z.infer<typeof CalibrationLabelSetSchema>;
export const CalibrationSnapshotSchema = z.array(
  z.object({
    kind: z.enum(['issue', 'check', 'point']),
    type: z.string(),
    n: z.number().int().nonnegative(),
    status: z.enum(['uncalibrated', 'reliable', 'unreliable']),
  }),
);
export type CalibrationSnapshot = z.infer<typeof CalibrationSnapshotSchema>;
