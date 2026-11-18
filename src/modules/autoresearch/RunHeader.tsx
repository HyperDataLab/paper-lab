import type { Run } from '@/core/autoresearch/record';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Select } from '@/shared/ui/Select';
import { endLabels } from './labels';
import styles from './autoresearch.module.css';

const formatDate = (at: string) =>
  new Date(at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

export function RunHeader({
  run,
  runs,
  busy,
  sharedModel,
  selectRun,
  create,
}: {
  run: Run;
  runs: Run[];
  busy: boolean;
  sharedModel: boolean;
  selectRun: (id: string) => void;
  create: () => void;
}) {
  return (
    <header>
      <h2 id="ar-title">AutoResearch</h2>
      {runs.length > 1 && (
        <Select
          label="Run của project"
          value={run.id}
          disabled={busy}
          onChange={(event) => selectRun(event.target.value)}
        >
          {runs.map((item) => (
            <option key={item.id} value={item.id}>
              {formatDate(item.createdAt)} · {item.endReason ? endLabels[item.endReason] : 'Đang mở'}
            </option>
          ))}
        </Select>
      )}
      {run.endReason && (
        <Badge tone={run.endReason === 'complete' ? 'success' : 'warning'}>{endLabels[run.endReason]}</Badge>
      )}
      {runs.every((item) => item.status === 'ended') && (
        <Button disabled={busy} onClick={create}>
          Tạo run mới
        </Button>
      )}
      {sharedModel && run.status !== 'ended' && (
        <p className={styles.warning}>
          PI và Critic đang dùng chung model. Bạn có thể đặt model Critic riêng trong Cài đặt.
        </p>
      )}
    </header>
  );
}
