import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { gsap, motionAllowed } from '@/shared/motion/gsap';
import { ToastContext } from './toastContext';
import styles from './ui.module.css';
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  return (
    <ToastContext.Provider value={(message) => setToast({ message })}>
      {children}
      {toast && <Toast message={toast.message} />}
    </ToastContext.Provider>
  );
}

/** A confirmation rises from the corner it lives in, so it reads as a reply to what the reader just did. */
function Toast({ message }: { message: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ref.current || !motionAllowed()) return;
    const tween = gsap.from(ref.current, {
      opacity: 0,
      y: 12,
      duration: 0.24,
      clearProps: 'opacity,transform',
    });
    return () => {
      tween.kill();
    };
  }, [message]);
  return (
    <div ref={ref} role="status" className={styles.toast}>
      {message}
    </div>
  );
}
