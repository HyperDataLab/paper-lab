import type { ReactNode } from 'react';
import styles from './ui.module.css';
export function Tabs({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {children}
    </div>
  );
}
