import type { ReactNode } from 'react';
import { Button } from './Button';
import styles from './ui.module.css';

/** One thing the system found, always in the same order: what kind, where, what it says, what to do. */
export function FindingCard({
  labels,
  quote,
  children,
  source,
  actions,
  state = 'open',
}: {
  labels: ReactNode;
  quote?: ReactNode;
  children?: ReactNode;
  source?: { label: ReactNode; onOpen: () => void; title?: string };
  actions?: ReactNode;
  state?: 'open' | 'confirmed' | 'dismissed';
}) {
  return (
    <article className={styles.finding} data-state={state}>
      <div className={styles.findingLabels}>{labels}</div>
      {quote && <blockquote className={styles.findingQuote}>{quote}</blockquote>}
      {children && <div className={styles.findingBody}>{children}</div>}
      {(source || actions) && (
        <div className={styles.findingFooter}>
          {source ? (
            <Button size="sm" variant="ghost" title={source.title} onClick={source.onOpen}>
              {source.label}
            </Button>
          ) : (
            <span />
          )}
          <div className={styles.findingActions}>{actions}</div>
        </div>
      )}
    </article>
  );
}

/**
 * The same review controls everywhere: a clear first choice, a quiet second, and undo once decided. With
 * `acceptByDefault` a result counts as accepted until a person rejects it, so rejecting is the only choice.
 */
export function ReviewActions({
  decided,
  confirmLabel = 'Xác nhận',
  dismissLabel = 'Bỏ qua',
  onConfirm,
  onDismiss,
  onUndo,
  acceptByDefault = false,
}: {
  decided: boolean;
  confirmLabel?: string;
  dismissLabel?: string;
  onConfirm: () => void;
  onDismiss: () => void;
  onUndo: () => void;
  acceptByDefault?: boolean;
}) {
  if (decided)
    return (
      <Button size="sm" variant="ghost" onClick={onUndo}>
        Hoàn tác
      </Button>
    );
  if (acceptByDefault)
    return (
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Bác bỏ
      </Button>
    );
  return (
    <>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        {dismissLabel}
      </Button>
      <Button size="sm" onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </>
  );
}
