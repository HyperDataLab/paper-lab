import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './ui.module.css';

/** What a screen shows while its data is on the way. One look everywhere, announced to screen readers. */
export function Loading({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div className={styles.loading} role="status" aria-label={label}>
      <span className={styles.skeletonBlock} aria-hidden="true" />
      <span className={styles.skeletonBlock} aria-hidden="true" />
      <span className={styles.skeletonBlock} aria-hidden="true" />
      <span className={styles.srOnly}>{label}</span>
    </div>
  );
}

/** What a list shows when it has nothing yet: what is missing, and how to get the first item. */
export function Empty({
  title,
  hint,
  icon,
  children,
}: {
  title: string;
  hint?: string;
  /** What is missing, as an icon; an inbox when not given. */
  icon?: ReactNode;
  /** The actions that fill it. */
  children?: ReactNode;
}) {
  return (
    <div className={styles.emptyNote}>
      <span className={styles.emptyIcon} aria-hidden="true">
        {icon ?? <Inbox size={22} />}
      </span>
      <strong>{title}</strong>
      {hint && <span className={styles.emptyHint}>{hint}</span>}
      {children && <div className={styles.emptyActions}>{children}</div>}
    </div>
  );
}
