import { useMemo } from 'react';
import { Card } from '@/shared/ui/Card';
import { DataTable } from '@/shared/ui/DataTable';
import { labelCoverage } from './machineLabels';
import type { LabelPaper, LabelScheme } from './labelPlan';
import { schemeNames, sectionRoleLabel } from './labels';
import styles from './corpus.module.css';

const SCHEMES: LabelScheme[] = ['rhetoric', 'stance', 'arguments'];
const share = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

export function LabelCoverage({ items }: { items: LabelPaper[] | undefined }) {
  const coverage = useMemo(() => (items ? labelCoverage(items, SCHEMES) : null), [items]);
  return (
    <Card>
      <section aria-labelledby="label-coverage" className={styles.members}>
        <div className={styles.cardHead}>
          <h2 id="label-coverage">Độ phủ nhãn</h2>
        </div>
        <p className={styles.muted}>
          Tính từ lượt chạy mới nhất của mỗi bài trên chỉ mục câu của paper model. Một bài được tính là đã phủ
          khi lượt đó dùng prompt hiện tại và đọc đủ các mục; tỷ lệ câu theo vai trò section chỉ tính trên các
          bài đã phủ.
        </p>
        {!coverage ? (
          <p>Đang tải…</p>
        ) : (
          <>
            <DataTable aria-label="Bài đã phủ">
              <thead>
                <tr>
                  <th>Loại nhãn</th>
                  <th>Đã phủ / đã dựng</th>
                </tr>
              </thead>
              <tbody>
                {coverage.members.map((row) => (
                  <tr key={row.scheme}>
                    <td>{schemeNames[row.scheme]}</td>
                    <td>
                      {row.covered}/{row.built}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            {coverage.roles.length > 0 && (
              <DataTable aria-label="Câu có nhãn theo vai trò section">
                <thead>
                  <tr>
                    <th>Vai trò mục</th>
                    {SCHEMES.map((scheme) => (
                      <th key={scheme}>{schemeNames[scheme]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {coverage.roles.map((row) => (
                    <tr key={row.role}>
                      <td>{sectionRoleLabel(row.role)}</td>
                      {SCHEMES.map((scheme) => {
                        const counts = row.schemes[scheme];
                        return (
                          <td key={scheme}>
                            {counts
                              ? `${share(counts.labelled, counts.sentences)} (${counts.labelled}/${counts.sentences})`
                              : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </>
        )}
      </section>
    </Card>
  );
}
