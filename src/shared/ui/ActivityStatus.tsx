import type { CSSProperties, ReactNode } from 'react';
import styles from './ui.module.css';

/** A calm, accessible indicator for work that continues asynchronously. */
export function ActivityStatus({
  label,
  progress,
}: {
  label: ReactNode;
  /** Supply only when the operation reports real completed/total work. */
  progress?: { value: number; max: number };
}) {
  const fraction = progress && progress.max > 0 ? Math.max(0, Math.min(1, progress.value / progress.max)) : null;
  return (
    <div className={styles.activityStatus} role="status" aria-live="polite" aria-busy="true">
      <span className={styles.activitySpinner} aria-hidden="true" />
      <span className={styles.activityLabel}>{label}</span>
      <span className={styles.activityTrack} aria-hidden="true">
        <span
          className={fraction === null ? styles.activityIndeterminate : styles.activityDeterminate}
          style={fraction === null ? undefined : ({ '--activity-progress': fraction } as CSSProperties)}
        />
      </span>
    </div>
  );
}
