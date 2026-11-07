import {
  AnalysisReportSchema,
  type Analysis,
  type AuditEvent,
  type Generation,
  type Revision,
} from '../schemas';
import { sliceCp } from '../text/offsets';

export function buildAnalysisReport(
  analysis: Analysis,
  options: {
    audit: AuditEvent[];
    revisions: Revision[];
    generation: Generation | null;
    parent: Analysis | null;
  },
) {
  const audit = options.audit.filter((event) => event.analysisId === analysis.id);
  const issues = { structure: [], flow: [], word: [], organization: [], critical: [] } as Record<
    Analysis['issues'][number]['category'],
    (Analysis['issues'][number] & {
      spans: (Analysis['issues'][number]['spans'][number] & { quote: string })[];
      decisions: AuditEvent[];
    })[]
  >;
  for (const issue of analysis.issues) {
    issues[issue.category].push({
      ...issue,
      spans: issue.spans.map((span) => ({
        ...span,
        quote: sliceCp(analysis.text.sourceText, span.start, span.end),
      })),
      decisions: audit.filter((event) => event.issueId === issue.id && event.actor === 'human'),
    });
  }
  return AnalysisReportSchema.parse({
    analysis,
    issues,
    audit,
    revisions: options.revisions.filter(
      (revision) =>
        revision.sourceAnalysisId === analysis.id ||
        (analysis.origin?.kind === 'revision' && revision.id === analysis.origin.revisionId),
    ),
    generation: options.generation,
    parent: options.parent,
    limits: [
      'Thang đánh giá chưa được hiệu chuẩn.',
      'Điểm số không đánh giá tính đúng đắn khoa học.',
      'Đánh giá của AI có thể thay đổi giữa các lần chạy.',
    ],
  });
}
