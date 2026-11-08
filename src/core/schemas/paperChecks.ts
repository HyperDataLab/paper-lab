import { z } from 'zod';
import { CalibrationSnapshotSchema } from './calibration';

export const CheckLocationSchema = z
  .object({
    paragraphId: z.string(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .refine((v) => v.end > v.start);
export const FindingSchema = z.object({
  id: z.string(),
  checkId: z.string(),
  severity: z.enum(['info', 'minor', 'moderate']),
  message: z.string(),
  locations: z.array(CheckLocationSchema),
  evidence: z.array(z.string()),
});
export const CheckResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['pass', 'warn', 'fail', 'not_applicable']),
  experimental: z.literal(true),
  summary: z.string(),
  findings: z.array(FindingSchema),
  falsePositiveNotes: z.array(z.string()),
});
export const PaperCheckReportSchema = z.object({
  version: z.literal('checks-1'),
  generatedAt: z.iso.datetime(),
  checks: z.array(CheckResultSchema),
  droppedLocations: z.number().int().nonnegative(),
});
export const CheckDecisionSchema = z.object({
  findingId: z.string(),
  status: z.enum(['confirmed_by_human', 'dismissed_by_human']),
  note: z.string(),
  at: z.iso.datetime(),
});
export const PaperChecksRecordSchema = z.object({
  calibrationSnapshot: CalibrationSnapshotSchema.nullable().optional(),
  schemaVersion: z.literal(1),
  paperId: z.uuid(),
  report: PaperCheckReportSchema,
  decisions: z.array(CheckDecisionSchema),
  reviewedAt: z.iso.datetime().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
export type PaperCheckReport = z.infer<typeof PaperCheckReportSchema>;
export type CheckDecision = z.infer<typeof CheckDecisionSchema>;
export type PaperChecksRecord = z.infer<typeof PaperChecksRecordSchema>;
