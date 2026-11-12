import type { ReactNode } from 'react';
import styles from './ui.module.css';

/** The muted line at the left of a sheet's footer: what the action will do or cost. */
export function SheetNote({ children }: { children: ReactNode }) {
  return <p className={styles.sheetNote}>{children}</p>;
}
