import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { gsap, motionAllowed } from '@/shared/motion/gsap';
import { IconButton } from './IconButton';
import styles from './ui.module.css';
export function Drawer({
  open,
  onClose,
  children,
  label = 'Điều hướng',
  side = 'left',
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label?: string;
  side?: 'left' | 'right';
  /** A visible title; the drawer then has a header with it and a close button. */
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  // Opening slides the panel in from its edge so the reader sees where it came from.
  useLayoutEffect(() => {
    if (!open || !motionAllowed() || !ref.current || !overlay.current) return;
    const timeline = gsap
      .timeline()
      .from(overlay.current, { opacity: 0, duration: 0.18, clearProps: 'opacity' })
      .from(
        ref.current,
        {
          xPercent: side === 'right' ? 100 : -100,
          duration: 0.3,
          ease: 'power3.out',
          clearProps: 'transform',
        },
        0,
      );
    return () => {
      timeline.kill();
    };
  }, [open, side]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    (focusable()[0] ?? panel)?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key === 'Tab') {
        const items = focusable();
        if (!items.length) {
          event.preventDefault();
          panel?.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first || !panel?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || !panel?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={overlay}
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`${styles.drawer} ${side === 'right' ? styles.drawerRight : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {title && (
          <div className={styles.drawerHead}>
            <h2>{title}</h2>
            <IconButton label="Đóng" onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
