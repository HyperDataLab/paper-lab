import type { ReactNode } from 'react';
import styles from './page.module.css';

/** One numbered stage of the paragraph analysis. A finished stage shows a tick and the word, not colour alone. */
export function AnalysisStep({
  number,
  done,
  children,
}: {
  number: number;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <li className={styles.step}>
      <span className={styles.stepNumber} data-done={done} aria-hidden="true">
        {done ? '✓' : number}
      </span>
      <div className={styles.stepBody}>
        {children}
        {done && <small>Đã xong</small>}
      </div>
    </li>
  );
}
