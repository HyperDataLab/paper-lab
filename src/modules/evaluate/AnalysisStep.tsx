import { Check, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './steps.module.css';

export type StepState = 'done' | 'running' | 'next' | 'idle' | 'blocked';

/**
 * One stage of the paragraph analysis, laid out as a column of a horizontal stepper: the marker and the line
 * to the next stage, what the stage produces, where it stands, and its action. A finished stage shows a tick
 * and says so in words, so state is never carried by colour alone.
 */
export function AnalysisStep({
  number,
  state,
  title,
  detail,
  children,
}: {
  number: number;
  state: StepState;
  title: string;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className={styles.step} data-state={state}>
      <div className={styles.rail} aria-hidden="true">
        <span className={styles.marker}>
          {state === 'done' ? (
            <Check size={14} strokeWidth={3} />
          ) : state === 'running' ? (
            <Loader2 size={14} className={styles.spin} />
          ) : (
            number
          )}
        </span>
        <span className={styles.line} />
      </div>
      <div className={styles.body}>
        <h3 className={styles.title}>{title}</h3>
        {detail && <div className={styles.detail}>{detail}</div>}
        {children && <div className={styles.action}>{children}</div>}
      </div>
    </li>
  );
}
