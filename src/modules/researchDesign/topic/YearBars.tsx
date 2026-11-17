import styles from './evidence.module.css';
export function YearBars({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...entries.map(([, count]) => count));
  return (
    <div>
      <div className={styles.bars}>
        {entries.map(([year, count]) => (
          <div key={year}>
            <div
              className={styles.bar}
              role="img"
              aria-label={`${year}: ${count} bài`}
              style={{ height: `${Math.max(2, (count / max) * 100)}px` }}
            />
            <span>{year}</span>
          </div>
        ))}
      </div>
      <table className={styles.hidden}>
        <caption>Số bài theo năm</caption>
        <thead>
          <tr>
            <th>Năm</th>
            <th>Số bài</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([year, count]) => (
            <tr key={year}>
              <td>{year}</td>
              <td>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
