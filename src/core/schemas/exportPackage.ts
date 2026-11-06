import { z } from 'zod';
import { AnalysisSchema } from './analysis';
import { AuditEventSchema } from './audit';
import { RevisionSchema } from './revision';
import { GenerationSchema } from './generation';
export const ExportPackageSchema = z.object({
  format: z.literal('paragraph-lab-export'),
  formatVersion: z.literal(1),
  exportedAt: z.iso.datetime(),
  appVersion: z.string(),
  analyses: z.array(AnalysisSchema),
  auditEvents: z.array(AuditEventSchema),
  revisions: z.array(RevisionSchema).default([]),
  generations: z.array(GenerationSchema).default([]),
});
export type ExportPackage = z.infer<typeof ExportPackageSchema>;
