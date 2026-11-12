import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import styles from './ui.module.css';
export function Dialog({
  title,
  description,
  onClose,
  returnFocus,
  kind = 'confirm',
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
  /** `confirm` asks for a decision (alertdialog); `form` collects input, as when creating something. */
  kind?: 'confirm' | 'form';
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const previous =
      returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const element = panel.current;
    const focusable = () =>
      Array.from(
        element?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    (
      element?.querySelector<HTMLElement>('[data-dialog-initial-focus]') ??
      focusable()[0] ??
      element
    )?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) {
        event.preventDefault();
        element?.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || !element?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !element?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [returnFocus]);
  return (
    <div
      className={styles.dialogOverlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`${styles.dialog} ${kind === 'form' ? styles.dialogForm : ''}`}
        ref={panel}
        role={kind === 'form' ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        {kind === 'form' && (
          <button type="button" className={styles.dialogClose} aria-label="Đóng" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        )}
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        {children}
      </div>
    </div>
  );
}

/** The row of buttons at the bottom of a form dialog: cancel first, the action last. */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className={styles.dialogActions}>{children}</div>;
}
