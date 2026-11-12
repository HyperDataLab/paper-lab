import type { ReactNode } from 'react';
import styles from './ui.module.css';

/** A titled group inside a side sheet (Drawer): one question the panel answers, or one part of its form. */
export function SheetSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.sheetSection}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
