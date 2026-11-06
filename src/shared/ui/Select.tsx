import { useId, type SelectHTMLAttributes } from 'react';
import styles from './ui.module.css';
type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  label: string;
  size?: 'md' | 'sm';
  inline?: boolean;
};
export function Select({ label, size = 'md', inline = false, id, ...props }: Props) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  return (
    <label className={`${styles.field} ${inline ? styles.fieldInline : ''}`} htmlFor={controlId}>
      {label}
      <select
        {...props}
        id={controlId}
        className={`${styles.fieldControl} ${size === 'sm' ? styles.controlSm : styles.controlMd}`}
      />
    </label>
  );
}
