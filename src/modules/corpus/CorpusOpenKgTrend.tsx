import type { CorpusKg } from '@/core/openkg';
import { DataTable } from '@/shared/ui/DataTable';
import styles from '@/shared/ui/openkg/openkg.module.css';

export function CorpusOpenKgTrend({ trend }: { trend: CorpusKg['trend'] }) {
  const rows = trend.keywords.map((keyword) => ({
    ...keyword,
    unknown: keyword.paperCount - Object.values(keyword.years).reduce((total, count) => total + count, 0),
  }));
  const hasUnknown = rows.some(({ unknown }) => unknown > 0);
  return (
    <div>
      <h3>Từ khóa theo năm</h3>
      {rows.length ? (
        <DataTable aria-label="Số bài theo từ khóa và năm xuất bản">
          <thead>
            <tr>
              <th scope="col">Từ khóa</th>
              <th scope="col">Tổng số bài</th>
              {trend.years.map((year) => (
                <th key={year} scope="col">
                  {year}
                </th>
              ))}
              {hasUnknown && <th scope="col">Chưa rõ năm</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, name, paperCount, years, unknown }) => (
              <tr key={id}>
                <th scope="row">{name}</th>
                <td>{paperCount}</td>
                {trend.years.map((year) => (
                  <td key={year}>{years[String(year)] ?? 0}</td>
                ))}
                {hasUnknown && <td>{unknown}</td>}
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <p className={styles.muted}>Chưa có từ khóa OpenAlex.</p>
      )}
    </div>
  );
}
