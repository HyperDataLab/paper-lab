import { findBenchmark, findMetric } from '@/core/researchDesign/bank/readSnapshot';
import type { BankDoc } from '@/core/researchDesign/bank/snapshot';
import type { FactsDoc } from '@/core/researchDesign/facts/factsDoc';
import { usage } from '@/core/researchDesign/facts/usage';
import type { Paper } from '@/core/researchDesign/papers';
import { Badge } from '@/shared/ui/Badge';
import styles from './evidence.module.css';

const KINDS = [
  ['baseline', 'Baseline'],
  ['dataset', 'Dataset'],
  ['metric', 'Metric'],
] as const;

/** How many papers use the same value, counted once per paper and only for facts set to Dùng. */
export function UsageCounts({
  papers,
  docs,
  bank,
}: {
  papers: Paper[];
  docs: Record<string, FactsDoc | undefined>;
  bank: BankDoc | null;
}) {
  const counts = usage(papers, docs, bank);
  const empty = KINDS.every(([kind]) => counts[kind].length === 0);
  return (
    <section className={styles.usage} aria-labelledby="evidence-usage-heading">
      <h3 id="evidence-usage-heading">Dùng trong nhiều bài</h3>
      {empty ? (
        <p className={styles.hint}>Chưa có dữ kiện nào được đặt Dùng</p>
      ) : (
        <div className={styles.usageGroups}>
          {KINDS.filter(([kind]) => counts[kind].length > 0).map(([kind, label]) => (
            <div key={kind}>
              <h4>{label}</h4>
              <ul className={styles.usageList}>
                {counts[kind].map((row) => (
                  <li key={row.key}>
                    <span>{row.label}</span>
                    {row.bankId &&
                      (findMetric(bank, row.bankId) ?? findBenchmark(bank, row.bankId))?.status ===
                        'draft' && <Badge>Bản nháp</Badge>}
                    <span className={styles.count}>{row.papers.length} bài</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
