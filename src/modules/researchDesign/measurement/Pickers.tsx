import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { bankBenchmarks, bankMetrics } from '@/core/researchDesign/bank/readSnapshot';
import type { BankDoc } from '@/core/researchDesign/bank/snapshot';
import { datasetFromBank, metricFromBank } from '@/core/researchDesign/draft/measureOps';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Chip } from '@/shared/ui/Chip';
import { Drawer } from '@/shared/ui/Drawer';
import { SheetSection } from '@/shared/ui/SheetSection';
import { TextField } from '@/shared/ui/TextField';
import type { DatasetInput } from './DatasetDialog';
import type { MetricInput } from './MetricDialog';
import { claimWord, word } from './words';
import styles from './Measurement.module.css';

const blankMetric = (): MetricInput => ({
  name: '',
  key: '',
  unit: '',
  goal: null,
  aggregation: null,
  protocol: '',
  bank: null,
  protocolBank: null,
});
const blankDataset = (): DatasetInput => ({
  name: '',
  source: '',
  version: null,
  split: null,
  sha256: null,
  benchmark: null,
});
const firstSentence = (text: string) => text.match(/^.*?[.!?](?:\s|$)/)?.[0].trim() ?? text;

/** Picks a metric or dataset from the pinned snapshot, or starts a blank one. */
export function Pickers({
  kind,
  bank,
  close,
  metric,
  dataset,
}: {
  kind: 'metrics' | 'datasets';
  bank: BankDoc | null;
  close: () => void;
  metric: (m: MetricInput) => void;
  dataset: (d: DatasetInput) => void;
}) {
  const [params] = useSearchParams();
  const [filter, setFilter] = useState('');
  const [family, setFamily] = useState('');
  const metrics = bankMetrics(bank);
  const text = filter.toLocaleLowerCase();
  const title = kind === 'metrics' ? 'Chọn metric' : 'Chọn dataset';
  const bankHref = (() => {
    const next = new URLSearchParams(params);
    next.set('design', 'bank');
    return `?${next.toString()}`;
  })();
  return (
    <Drawer
      open
      onClose={close}
      side="right"
      size="lg"
      label={title}
      title={title}
      description={
        kind === 'metrics'
          ? 'Metric từ bản chụp Writing Bank của dự án.'
          : 'Benchmark từ bản chụp Writing Bank của dự án.'
      }
      footer={
        kind === 'metrics' ? (
          <Button onClick={() => metric(blankMetric())}>Tự mô tả metric</Button>
        ) : (
          <Button onClick={() => dataset(blankDataset())}>Tự mô tả dataset</Button>
        )
      }
    >
      {!bank && (
        <p className={styles.quiet}>
          Chưa có bản chụp. <Link to={bankHref}>Writing Bank</Link>
        </p>
      )}
      {bank && <TextField label="Tìm kiếm" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      {kind === 'metrics' && bank && (
        <SheetSection title="Nhóm metric">
          <div className={styles.chips}>
            <Chip count={metrics.length} aria-pressed={!family} onClick={() => setFamily('')}>
              Tất cả
            </Chip>
            {[...new Set(metrics.map((m) => m.family))].map((f) => (
              <Chip
                key={f}
                count={metrics.filter((m) => m.family === f).length}
                aria-pressed={family === f}
                onClick={() => setFamily(f)}
              >
                {word(f)}
              </Chip>
            ))}
          </div>
        </SheetSection>
      )}
      {kind === 'metrics' &&
        bank &&
        metrics
          .filter(
            (m) =>
              (!family || m.family === family) &&
              [m.name, ...m.aliases].some((s) => s.toLocaleLowerCase().includes(text)),
          )
          .map((m) => (
            <div className={styles.row} key={m.id}>
              <h3 className={styles.title}>{m.name}</h3>
              {m.status === 'draft' && <Badge>Bản nháp của bank</Badge>}
              <p className={styles.quiet}>
                {word(m.family)} · {m.unit || 'không có đơn vị'} · {word(m.direction)}
              </p>
              <p>{firstSentence(m.definition)}</p>
              <p className={styles.quiet}>Claim mạnh nhất mà metric tự nó hỗ trợ: {claimWord(m.maxClaim)}</p>
              {m.doesNotSupport.map((s) => (
                <p key={s} className={styles.quiet}>
                  Không hỗ trợ: {s}
                </p>
              ))}
              <Button size="sm" onClick={() => metric(metricFromBank(m, bank.release))}>
                Dùng
              </Button>
            </div>
          ))}
      {kind === 'datasets' &&
        bank &&
        bankBenchmarks(bank)
          .filter((b) => b.name.toLocaleLowerCase().includes(text))
          .map((b) => (
            <div className={styles.row} key={b.id}>
              <h3 className={styles.title}>{b.name}</h3>
              {b.status === 'draft' && <Badge>Bản nháp của bank</Badge>}
              <p className={styles.quiet}>
                {b.task} · {word(b.lifecycle)}
              </p>
              {b.knownFlaws.map((s) => (
                <p key={s}>{s}</p>
              ))}
              <Button size="sm" onClick={() => dataset(datasetFromBank(b, bank.release))}>
                Dùng
              </Button>
            </div>
          ))}
    </Drawer>
  );
}
