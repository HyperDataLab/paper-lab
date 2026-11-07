import { z } from 'zod';
import { AnalysisSchema } from './analysis';
import { AuditEventSchema } from './audit';
import { GenerationSchema } from './generation';
import { IssueSchema } from './issue';
import { RevisionSchema } from './revision';

const ReportIssueSchema = IssueSchema.extend({
  spans: z.array(IssueSchema.shape.spans.element.and(z.object({ quote: z.string() }))),
  decisions: z.array(AuditEventSchema),
});

export const AnalysisReportSchema = z.object({
  analysis: AnalysisSchema.omit({ issues: true }),
  issues: z.object({
    structure: z.array(ReportIssueSchema),
    flow: z.array(ReportIssueSchema),
    word: z.array(ReportIssueSchema),
    organization: z.array(ReportIssueSchema),
    critical: z.array(ReportIssueSchema),
  }),
  audit: z.array(AuditEventSchema),
  revisions: z.array(RevisionSchema),
  generation: GenerationSchema.nullable(),
  parent: AnalysisSchema.nullable(),
  limits: z.array(z.string()),
});
export const JsonReportSchema = z.object({
  format: z.literal('paragraph-lab-report'),
  formatVersion: z.literal(1),
  report: AnalysisReportSchema,
});
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;
