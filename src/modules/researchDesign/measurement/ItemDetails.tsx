import { Link } from 'react-router-dom';
import { findBenchmark, findMetric } from '@/core/researchDesign/bank/readSnapshot';
import type { BankDoc } from '@/core/researchDesign/bank/snapshot';
import type {
  Draft,
  DraftCondition,
  DraftDataset,
  DraftMetric,
  DraftVariable,
} from '@/core/researchDesign/draft/schema';
import { Badge } from '@/shared/ui/Badge';
import { word } from './words';
import styles from './Measurement.module.css';

export type Item = DraftVariable | DraftMetric | DraftDataset | DraftCondition;

/** The summary line under one variable, metric, dataset or condition. */
export function ItemDetails({
  item,
  draft,
  bank,
  metricsHref,
}: {
  item: Item;
  draft: Draft;
  bank: BankDoc | null;
  metricsHref: string;
}) {
  if ('role' in item)
    return (
      <p className={styles.quiet}>
        {word(item.role)}
        {item.construct && ` · Khái niệm: ${item.construct}`}
        {(item.role === 'dependent' || item.role === 'covariate') && (
          <>
            {' · '}
            {item.metric ? (
              <Link to={metricsHref}>
                Metric: {item.metric} {draft.metrics.find((m) => m.id === item.metric)?.name}
              </Link>
            ) : (
              'chưa có metric'
            )}
          </>
        )}
        {item.role === 'independent' &&
          ` · ${item.levels.length ? `Các mức: ${item.levels.join(', ')}` : 'chưa có mức'}`}
      </p>
    );
  if ('goal' in item)
    return (
      <>
        <p className={styles.quiet}>
          <span className={styles.mono}>{item.key || 'chưa có key'}</span> · {item.unit || 'chưa có đơn vị'} ·{' '}
          {item.goal ? word(item.goal) : 'chưa chọn hướng tốt'} ·{' '}
          {item.aggregation ? word(item.aggregation) : 'chưa chọn cách gộp'}
        </p>
        {item.bank && findMetric(bank, item.bank.id)?.status === 'draft' && <Badge>Bản nháp của bank</Badge>}
      </>
    );
  if ('source' in item) {
    const benchmark = item.benchmark && findBenchmark(bank, item.benchmark.id);
    return (
      <>
        <p className={styles.quiet}>
          {[item.source || 'Chưa ghi nguồn', item.version, item.split].filter(Boolean).join(' · ')}
        </p>
        {benchmark && (
          <>
            <p>
              {word(benchmark.lifecycle)} · {benchmark.knownFlaws.join(' · ')}
            </p>
            {benchmark.status === 'draft' && <Badge>Bản nháp của bank</Badge>}
          </>
        )}
      </>
    );
  }
  return (
    <p className={styles.mono}>
      {Object.entries(item.params)
        .map(([k, v]) => `${k} = ${String(v)}`)
        .join(' · ')}
    </p>
  );
}
