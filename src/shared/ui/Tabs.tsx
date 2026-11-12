import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { gsap, motionAllowed } from '@/shared/motion/gsap';
import styles from './ui.module.css';

/**
 * A tab list whose underline slides to the chosen tab, so the reader sees where the view moved.
 * The underline is a 1px bar scaled to the tab's width (a transform, never a layout change).
 */
export function Tabs({ children, label }: { children: ReactNode; label: string }) {
  const list = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const root = list.current;
    const line = bar.current;
    if (!root || !line) return;
    const place = (animate: boolean) => {
      const tab =
        root.querySelector<HTMLElement>(':scope > [role="tab"][aria-selected="true"]') ??
        root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!tab) {
        gsap.set(line, { autoAlpha: 0 });
        placed.current = false;
        return;
      }
      const vars = { x: tab.offsetLeft, scaleX: tab.offsetWidth, autoAlpha: 1 };
      if (animate && placed.current && motionAllowed())
        gsap.to(line, { ...vars, duration: 0.26, ease: 'power3.out', overwrite: 'auto' });
      else gsap.set(line, vars);
      placed.current = true;
      root.dataset.indicator = 'true';
    };
    place(true);
    if (typeof ResizeObserver !== 'function') return;
    // Web fonts and container resizes change tab widths after the first placement.
    const observer = new ResizeObserver(() => place(false));
    observer.observe(root);
    return () => observer.disconnect();
  });
  return (
    <div ref={list} className={styles.tabs} role="tablist" aria-label={label}>
      {children}
      <span ref={bar} className={styles.tabIndicator} aria-hidden="true" />
    </div>
  );
}
