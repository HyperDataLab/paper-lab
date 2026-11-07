import { JsonReportSchema, type AnalysisReport } from '../schemas';

/** Reports are for reading; only paragraph-lab-export packages can be imported. */
export function toJsonReport(report: AnalysisReport): string {
  const parsed = JsonReportSchema.parse({ format: 'paragraph-lab-report', formatVersion: 1, report });
  return JSON.stringify(
    parsed,
    (_key, value: unknown) => {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')));
      }
      return value;
    },
    2,
  );
}
