import type { InputHTMLAttributes, ReactNode } from 'react';
import styles from './ui.module.css';
export function Checkbox({
  children,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { children: ReactNode }) {
  return (
    <label className={styles.checkbox}>
      <input {...props} type="checkbox" />
      {children}
    </label>
  );
}
