import { ExportPackageSchema, type Analysis, type AuditEvent, type Revision } from '../schemas';
export function buildExportPackage(
  analyses: Analysis[],
  auditEvents: AuditEvent[],
  appVersion: string,
  now: Date,
  revisions: Revision[] = [],
) {
  return ExportPackageSchema.parse({
    format: 'paragraph-lab-export',
    formatVersion: 1,
    exportedAt: now.toISOString(),
    appVersion,
    analyses,
    auditEvents,
    revisions,
  });
}
