import type { Revision } from '@/core/schemas';
import { sliceCp } from '@/core/text';
import styles from './page.module.css';

export function DiffView({
  source,
  revision,
  selectedCheck,
}: {
  source: string;
  revision: Revision;
  selectedCheck: string | null;
}) {
  const render = (side: 'source' | 'revised') => {
    const text = side === 'source' ? source : revision.revisedText;
    const marks = revision.hunks.flatMap((hunk) => {
      const span = side === 'source' ? hunk.before : hunk.after;
      return span && hunk.kind !== 'equal' ? [{ ...span, kind: hunk.kind }] : [];
    });
    const risks =
      revision.checks
        .find((check) => check.id === selectedCheck)
        ?.spans.filter((span) => span.side === side) ?? [];
    const boundaries = [
      ...new Set([
        0,
        Array.from(text).length,
        ...marks.flatMap((span) => [span.start, span.end]),
        ...risks.flatMap((span) => [span.start, span.end]),
      ]),
    ].sort((a, b) => a - b);
    return boundaries.slice(0, -1).map((start, index) => {
      const end = boundaries[index + 1] ?? start;
      const mark = marks.find((item) => item.start <= start && item.end >= end);
      const risk = risks.some((item) => item.start <= start && item.end >= end);
      const value = sliceCp(text, start, end);
      return mark || risk ? (
        <mark
          key={start}
          className={`${mark ? styles[side === 'source' ? 'deleted' : 'inserted'] : ''} ${risk ? styles.risk : ''}`}
          aria-label={`${mark ? (side === 'source' ? 'Văn bản bị xoá hoặc thay thế' : 'Văn bản được thêm hoặc thay thế') : ''}${risk ? ' Đoạn cần kiểm tra ý nghĩa' : ''}`}
        >
          {value}
        </mark>
      ) : (
        value
      );
    });
  };
  return (
    <>
      <div className={styles.diff}>
        <section>
          <h3>Bản gốc</h3>
          <p className={styles.reading}>{render('source')}</p>
        </section>
        <section>
          <h3>Bản sửa</h3>
          <p className={styles.reading}>{render('revised')}</p>
        </section>
      </div>
      <h3>Thay đổi</h3>
      <ul>
        {revision.hunks.map((hunk, index) =>
          hunk.kind === 'equal' ? null : (
            <li key={index}>
              {hunk.unexplained
                ? 'Thay đổi chưa có giải thích'
                : hunk.changeIndexes.map((changeIndex) => {
                    const change = revision.changes[changeIndex];
                    return change ? (
                      <span key={changeIndex}>
                        {change.rationale} · {change.issueIds.join(', ')}
                      </span>
                    ) : null;
                  })}
            </li>
          ),
        )}
      </ul>
    </>
  );
}
