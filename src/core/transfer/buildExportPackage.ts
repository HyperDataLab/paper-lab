import { ExportPackageSchema, type Analysis, type AuditEvent } from '../schemas';
export function buildExportPackage(
  analyses: Analysis[],
  auditEvents: AuditEvent[],
  appVersion: string,
  now: Date,
) {
  return ExportPackageSchema.parse({
    format: 'paragraph-lab-export',
    formatVersion: 1,
    exportedAt: now.toISOString(),
    appVersion,
    analyses,
    auditEvents,
  });
}
