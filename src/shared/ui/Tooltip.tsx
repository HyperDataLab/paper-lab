import type { ReactNode } from 'react';
import styles from './ui.module.css';
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className={styles.tooltip} data-label={label}>
      {children}
    </span>
  );
}
