import type { AnalysisReport } from '@/core/schemas';
import { sliceCp } from '@/core/text';
import styles from './report.module.css';

export function ReportText({ report }: { report: AnalysisReport }) {
  const text = report.analysis.text.sourceText;
  const issues = Object.values(report.issues).flat();
  const spans = issues.flatMap((issue, index) =>
    issue.spans.map((span) => ({ ...span, category: issue.category, number: index + 1 })),
  );
  const points = [
    ...new Set([0, Array.from(text).length, ...spans.flatMap((span) => [span.start, span.end])]),
  ].sort((a, b) => a - b);
  return (
    <>
      <p>Cấu trúc: liền; mạch: nét đứt; từ ngữ: chấm; tổ chức: lượn sóng; rủi ro: nét đôi.</p>
      <p className={styles.reading}>
        {points.slice(0, -1).map((start, i) => {
          const end = points[i + 1] ?? start;
          const active = spans.filter((span) => span.start <= start && span.end >= end);
          return (
            <span key={start}>
              {active.length ? (
                <span className={styles[active[0]?.category ?? 'structure']}>
                  {sliceCp(text, start, end)}
                </span>
              ) : (
                sliceCp(text, start, end)
              )}
              {spans
                .filter((span) => span.end === end)
                .map((span, n) => (
                  <sup key={`${span.number}-${n}`}>[{span.number}]</sup>
                ))}
            </span>
          );
        })}
      </p>
    </>
  );
}
