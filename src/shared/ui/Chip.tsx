import type { ComponentProps } from 'react';
import { Button } from './Button';
import styles from './ui.module.css';
export function Chip({
  className = '',
  count,
  children,
  ...props
}: ComponentProps<typeof Button> & { count?: number }) {
  return (
    <Button {...props} size="sm" className={`${styles.chip} ${className}`}>
      {children}
      {count !== undefined && ` (${count})`}
    </Button>
  );
}
