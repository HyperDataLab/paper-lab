import { useEffect, useRef, useState } from 'react';
import { Button } from '@/shared/ui/Button';
import styles from './page.module.css';

export function JobProgress({
  running,
  count,
  onOpen,
  sequence,
}: {
  running: string[];
  count: number;
  onOpen: () => void;
  sequence?: { label: string; index: number; total: number } | null;
}) {
  const [done, setDone] = useState(false);
  const wasRunning = useRef(false);
  const [startCount, setStartCount] = useState(count);
  useEffect(() => {
    if ((running.length || sequence) && !wasRunning.current) {
      setStartCount(count);
      setDone(false);
    } else if (!running.length && !sequence && wasRunning.current) setDone(true);
    wasRunning.current = running.length > 0 || !!sequence;
  }, [running.length, count, sequence]);
  if (sequence)
    return (
      <span role="status" className={styles.runStrip}>
        Đang chạy: {sequence.label} {sequence.index}/{sequence.total}
      </span>
    );
  if (running.length)
    return (
      <span role="status" className={styles.runStrip}>
        Đang chạy: {running[0]} 1/{running.length}
      </span>
    );
  if (!done) return null;
  return (
    <span className={styles.runStrip}>
      <Button size="sm" onClick={onOpen}>
        Xong · +{Math.max(0, count - startCount)} issues
      </Button>
      <Button size="sm" variant="ghost" aria-label="Ẩn tiến độ" onClick={() => setDone(false)}>
        ×
      </Button>
    </span>
  );
}
