import type { ReactNode } from 'react';
import styles from './ui.module.css';
export function Card({
  children,
  padding = 'lg',
  className,
}: {
  children: ReactNode;
  padding?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <section
      data-surface="card"
      className={`${styles.card} ${padding === 'md' ? styles.cardMd : ''} ${className ?? ''}`}
    >
      {children}
    </section>
  );
}
