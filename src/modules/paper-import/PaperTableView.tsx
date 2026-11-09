import type { PaperParagraph, PaperTable } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import styles from './page.module.css';

export function PaperTableView({ table, caption }: { table: PaperTable; caption?: PaperParagraph }) {
  const columns = Array.from({ length: table.columns }, (_, index) => index);
  return (
    <div>
      {table.confidence === 'low' && <Badge>Cần xem lại</Badge>}
      {caption && (
        <p className={styles.tableCaption}>
          <a href={`#paper-paragraph-${caption.id}`}>{caption.text}</a>
        </p>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <tbody>
            {table.rows.map((row, rowIndex) => {
              const unaligned = row.cells.filter((cell) => cell.column === null);
              return (
                <tr key={rowIndex}>
                  {columns.map((column) => (
                    <td key={column}>{row.cells.find((cell) => cell.column === column)?.text ?? ''}</td>
                  ))}
                  {unaligned.length > 0 && <td>{unaligned.map((cell) => cell.text).join(' ')}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
