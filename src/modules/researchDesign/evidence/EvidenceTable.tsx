import { Link } from 'react-router-dom';
import { comparisonRows } from '@/core/researchDesign/facts/view';
import type { FactsDoc } from '@/core/researchDesign/facts/factsDoc';
import type { Paper } from '@/core/researchDesign/papers';
import { Badge } from '@/shared/ui/Badge';
import { Checkbox } from '@/shared/ui/Checkbox';
import { Chip } from '@/shared/ui/Chip';
import { DataTable } from '@/shared/ui/DataTable';
import type { Selection } from './factsDocs';
import styles from './evidence.module.css';

const COLUMNS = ['Task', 'Dataset', 'Baseline', 'Phương pháp', 'Metric', 'Thiết kế', 'Mẫu', 'Kết quả'];
/** Kinds PaperLab's measurement does not produce yet (task, design, sample). */
const NOT_SUPPLIED = new Set([0, 5, 6]);
const same = (a: Selection, b: Selection) => a.paperId === b.paperId && a.factId === b.factId;

/** Project papers by fact kind; values and PaperLab's status are shown as they came. */
export function EvidenceTable({
  papers,
  docs,
  selected,
  setSelected,
  open,
}: {
  papers: Paper[];
  docs: Record<string, FactsDoc | undefined>;
  selected: Selection[];
  setSelected: (update: (current: Selection[]) => Selection[]) => void;
  open: (selection: Selection) => void;
}) {
  const rows = comparisonRows(papers, docs);
  return (
    <DataTable className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Bài báo</th>
          {COLUMNS.map((label, index) => (
            <th scope="col" key={label}>
              {label}
              {NOT_SUPPLIED.has(index) && <div className={styles.muted}>PaperLab chưa cung cấp</div>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const paperId = row.paper.model?.paperlab?.paperId;
          return (
            <tr key={row.paper.id}>
              <th scope="row">
                {paperId ? (
                  <Link to={`/papers/${encodeURIComponent(paperId)}`}>{row.paper.title}</Link>
                ) : (
                  row.paper.title
                )}
              </th>
              {!docs[row.paper.id]?.facts.facts.length ? (
                <td colSpan={COLUMNS.length} className={styles.muted}>
                  Chưa có dữ kiện
                  {paperId ? (
                    <>
                      {' · '}
                      <Link to={`/papers/${encodeURIComponent(paperId)}?view=measure`}>
                        Chạy Đo lường cho bài này
                      </Link>
                    </>
                  ) : (
                    ' · Bài này chưa có bản đầy đủ trong PaperLab'
                  )}
                </td>
              ) : (
                row.cells.map((cell) => (
                  <td key={cell.kind}>
                    {!cell.items.length ? (
                      <span className={styles.muted}>Không có</span>
                    ) : (
                      <div className={styles.cell}>
                        {cell.items.map(({ fact, decision, status }) => {
                          const selection = { paperId: row.paper.id, factId: fact.id };
                          return (
                            <div key={fact.id} className={styles.row}>
                              <Checkbox
                                aria-label={`Chọn ${fact.value}`}
                                checked={selected.some((entry) => same(entry, selection))}
                                onChange={(event) => {
                                  const checked = event.target.checked;
                                  setSelected((current) =>
                                    checked
                                      ? [...current, selection]
                                      : current.filter((entry) => !same(entry, selection)),
                                  );
                                }}
                              >
                                {null}
                              </Checkbox>
                              <Chip onClick={() => open(selection)}>
                                {fact.value}
                                {decision && (
                                  <Badge tone={decision.decision === 'use' ? 'success' : 'neutral'}>
                                    {decision.decision === 'use' ? 'Dùng' : 'Loại'}
                                  </Badge>
                                )}
                                {status === 'candidate' && <Badge>Chưa duyệt</Badge>}
                              </Chip>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                ))
              )}
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}
