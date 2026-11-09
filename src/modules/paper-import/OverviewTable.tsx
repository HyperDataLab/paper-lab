import type { Paper, PaperOverview } from '@/core/schemas';
import { DIMENSIONS } from '@/core/scoring/rubric';
import { SECTION_ROLE_LABELS } from './sectionRoles';
import styles from './overview.module.css';

const categories = {
  structure: 'Cấu trúc câu',
  flow: 'Mạch',
  word: 'Từ ngữ',
  organization: 'Tổ chức đoạn',
  critical: 'Rủi ro nghĩa',
} as const;
const number = (value: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
export function OverviewTable({ paper, overview }: { paper: Paper; overview: PaperOverview }) {
  const rows = overview.sections.filter((section) => section.analysed > 0);
  if (!rows.length)
    return <p>Chưa có đoạn nào được phân tích. Chọn mục ở phần trên rồi bấm Bắt đầu phân tích.</p>;
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Mục</th>
            <th scope="col">Độ bao phủ</th>
            <th scope="col">Vấn đề cần xem lại</th>
            {DIMENSIONS.map((dimension) => (
              <th scope="col" key={dimension.id}>
                {dimension.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((section) => {
            const info = paper.sections.find((item) => item.id === section.sectionId);
            const max = Math.max(1, ...Object.values(section.issuesByCategory));
            return (
              <tr key={section.sectionId}>
                <th scope="row">
                  {info ? `${SECTION_ROLE_LABELS[info.role]} · ${info.heading}` : section.sectionId}
                </th>
                <td>
                  {section.analysed}/{section.bodyParagraphs} ({number(section.coverage * 100)} %)
                </td>
                <td>
                  {Object.entries(categories).map(([id, label]) => {
                    const count = section.issuesByCategory[id] ?? 0;
                    if (!count) return null;
                    return (
                      <div key={id} className={styles.issueRow}>
                        <span>
                          {label}: {count}
                        </span>
                        <span aria-hidden="true" className={styles.barTrack}>
                          <span className={styles.bar} style={{ width: `${(count / max) * 100}%` }} />
                        </span>
                        <span>{count}</span>
                      </div>
                    );
                  })}
                </td>
                {DIMENSIONS.map((dimension) => {
                  const value = section.scores[dimension.id];
                  return (
                    <td key={dimension.id}>
                      {value
                        ? `${number(value.median)} (${number(value.q1)}–${number(value.q3)}, n = ${value.n})`
                        : 'Chưa đủ dữ liệu'}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
