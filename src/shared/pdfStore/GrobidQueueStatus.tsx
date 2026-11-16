import { Badge } from '@/shared/ui/Badge';
import type { GrobidQueueStatus as Status } from './grobidQueue';

export function GrobidQueueStatus({ value }: { value: Status | undefined }) {
  if (!value) return null;
  const labels = {
    queued: 'Chờ xử lý',
    running: 'Đang xử lý',
    ready: 'Đã xong',
    failed: 'Thất bại',
    waiting: 'Chờ đăng nhập',
  };
  return (
    <span>
      <Badge tone={value.status === 'failed' ? 'danger' : value.status === 'ready' ? 'success' : 'neutral'}>
        GROBID: {labels[value.status]}
      </Badge>
      {value.reason && <span> · {value.reason}</span>}
    </span>
  );
}

export function GrobidQueueSummary({ statuses }: { statuses: Record<string, Status> }) {
  const values = Object.values(statuses);
  return values.length ? (
    <p aria-live="polite">
      GROBID {values.filter((value) => value.status === 'ready').length}/{values.length}
    </p>
  ) : null;
}
