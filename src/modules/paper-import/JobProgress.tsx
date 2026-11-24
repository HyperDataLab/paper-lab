import { useEffect, useRef, useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { ActivityStatus } from '@/shared/ui/ActivityStatus';
import styles from './page.module.css';
import type { RunProgress } from './paperJobs';

export function JobProgress({
  running,
  count,
  onOpen,
  sequence,
}: {
  running: string[];
  count: number;
  onOpen: () => void;
  sequence?: RunProgress | null;
}) {
  const [done, setDone] = useState(false);
  const wasRunning = useRef(false);
  const [startCount, setStartCount] = useState(count);
  useEffect(() => {
    const active = running.length > 0 || Boolean(sequence && 'labels' in sequence);
    if (active && !wasRunning.current) {
      setStartCount(count);
      setDone(false);
    } else if (!active && wasRunning.current) setDone(true);
    wasRunning.current = active;
  }, [running.length, count, sequence]);
  if (sequence && 'labels' in sequence)
    return (
      <div className={styles.runStrip}>
        <ActivityStatus
          label={`Đang phân tích · ${sequence.completed}/${sequence.total} mục đích xong`}
          progress={{ value: sequence.completed, max: sequence.total }}
        />
      </div>
    );
  if (running.length)
    return (
      <div className={styles.runStrip}>
        <ActivityStatus label={`Đang chạy: ${running[0]} · ${running.length} tác vụ`} />
      </div>
    );
  if (!done) return null;
  return (
    <span className={styles.runStrip}>
      <Button size="sm" onClick={onOpen}>
        {sequence && 'incomplete' in sequence && sequence.incomplete.length > 0
          ? `Xong một phần · ${sequence.incomplete.length} chưa trọn vẹn`
          : 'Xong'}{' '}
        · +{Math.max(0, count - startCount)} issues
      </Button>
      <Button size="sm" variant="ghost" aria-label="Ẩn tiến độ" onClick={() => setDone(false)}>
        ×
      </Button>
    </span>
  );
}
