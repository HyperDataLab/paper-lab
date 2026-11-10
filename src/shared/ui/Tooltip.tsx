import { useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './ui.module.css';
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const show = (event: PointerEvent<HTMLSpanElement> | FocusEvent<HTMLSpanElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition({ left: rect.right + 8, top: rect.top + rect.height / 2 });
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
