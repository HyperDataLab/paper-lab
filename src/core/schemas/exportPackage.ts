import { z } from 'zod';
import { CorpusSchema } from './corpus';
import { AnalysisSchema } from './analysis';
import { AuditEventSchema } from './audit';
import { RevisionSchema } from './revision';
import { GenerationSchema } from './generation';
import { PaperSchema } from './paper';
import { PaperOverviewRecordSchema } from './paperOverview';
import { PaperChecksRecordSchema } from './paperChecks';
import { PaperReviewsRecordSchema } from './paperReview';
import { PaperProbesRecordSchema } from './paperProbe';
import { MeasurementsRecordSchema } from './measurement';
import { LibraryItemSchema } from './library';
import { StanceRecordSchema } from './stance';
import { PaperInsightsRecordSchema } from './paperInsights';
import { ExtractionProjectSchema } from './extraction';
import { CalibrationLabelSetSchema } from './calibration';
export const ExportPackageSchema = z.object({
  format: z.literal('paragraph-lab-export'),
  formatVersion: z.literal(1),
  exportedAt: z.iso.datetime(),
  appVersion: z.string(),
  analyses: z.array(AnalysisSchema),
  auditEvents: z.array(AuditEventSchema),
  revisions: z.array(RevisionSchema).default([]),
  generations: z.array(GenerationSchema).default([]),
  papers: z.array(PaperSchema).default([]),
  paperOverviews: z.array(PaperOverviewRecordSchema).default([]),
  paperChecks: z.array(PaperChecksRecordSchema).default([]),
  paperReviews: z.array(PaperReviewsRecordSchema).default([]),
  paperProbes: z.array(PaperProbesRecordSchema).default([]),
  calibrationLabels: z.array(CalibrationLabelSetSchema).default([]),
  measurements: z.array(MeasurementsRecordSchema).default([]),
  library: z.array(LibraryItemSchema).default([]),
  stance: z.array(StanceRecordSchema).default([]),
  paperInsights: z.array(PaperInsightsRecordSchema).default([]),
  extractionProjects: z.array(ExtractionProjectSchema).default([]),
  corpora: z.array(CorpusSchema).default([]),
});
export type ExportPackage = z.infer<typeof ExportPackageSchema>;
