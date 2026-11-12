import { useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './ui.module.css';
/** A short label for an icon-only control: above it by default, beside it in the sidebar rail. */
export function Tooltip({
  label,
  children,
  side = 'top',
}: {
  label: string;
  children: ReactNode;
  side?: 'top' | 'right';
}) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const show = (event: PointerEvent<HTMLSpanElement> | FocusEvent<HTMLSpanElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition(
      side === 'right'
        ? { left: rect.right + 8, top: rect.top + rect.height / 2 }
        : { left: rect.left + rect.width / 2, top: rect.top - 6 },
    );
  };

  return (
    <span
      className={styles.tooltip}
      onPointerEnter={show}
      onPointerLeave={() => setPosition(null)}
      onFocusCapture={show}
      onBlurCapture={() => setPosition(null)}
    >
      {children}
      {position &&
        typeof document !== 'undefined' &&
        createPortal(
          <span
            className={styles.tooltipBubble}
            data-side={side}
            role="tooltip"
            style={{ left: position.left, top: position.top }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
