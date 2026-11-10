import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import styles from './data-table.module.css';

type Props = ComponentPropsWithoutRef<'table'> & {
  children: ReactNode;
  scrollClassName?: string;
};

export function DataTable({ children, className = '', scrollClassName = '', ...props }: Props) {
  return (
    <div className={`${styles.scroll} ${scrollClassName}`}>
      <table {...props} className={`${styles.table} ${className}`}>
        {children}
      </table>
    </div>
  );
}
