import { z } from 'zod';
import { AnalysisSchema } from './analysis';
import { AuditEventSchema } from './audit';
export const ExportPackageSchema = z.object({
  format: z.literal('paragraph-lab-export'),
  formatVersion: z.literal(1),
  exportedAt: z.iso.datetime(),
  appVersion: z.string(),
  analyses: z.array(AnalysisSchema),
  auditEvents: z.array(AuditEventSchema),
});
export type ExportPackage = z.infer<typeof ExportPackageSchema>;
