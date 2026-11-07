import {
  ExportPackageSchema,
  type Analysis,
  type AuditEvent,
  type Revision,
  type Generation,
  type Paper,
} from '../schemas';
export function buildExportPackage(
  analyses: Analysis[],
  auditEvents: AuditEvent[],
  appVersion: string,
  now: Date,
  revisions: Revision[] = [],
  generations: Generation[] = [],
  papers: Paper[] = [],
) {
  return ExportPackageSchema.parse({
    format: 'paragraph-lab-export',
    formatVersion: 1,
    exportedAt: now.toISOString(),
    appVersion,
    analyses,
    auditEvents,
    revisions,
    generations,
    papers,
  });
}
