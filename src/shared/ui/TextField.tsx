import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes, type Ref } from 'react';
import styles from './ui.module.css';

type Common = { label: string; hint?: string; error?: string; size?: 'md' | 'sm' };
type Props = Common &
  (
    | ({ multiline?: false; ref?: Ref<HTMLInputElement> } & Omit<
        InputHTMLAttributes<HTMLInputElement>,
        'size'
      >)
    | ({ multiline: true; ref?: Ref<HTMLTextAreaElement> } & TextareaHTMLAttributes<HTMLTextAreaElement>)
  );
export function TextField({ label, hint, error, size = 'md', ...props }: Props) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  const control = props.multiline
    ? (() => {
        const { multiline: _multiline, ...rest } = props;
        void _multiline;
        return (
          <textarea
            {...rest}
            id={id}
            className={`${styles.fieldControl} ${styles.multiline}`}
            aria-invalid={!!error}
            aria-describedby={describedBy}
          />
        );
      })()
    : (() => {
        const { multiline: _multiline, ...rest } = props;
        void _multiline;
        return (
          <input
            {...rest}
            id={id}
            className={`${styles.fieldControl} ${size === 'sm' ? styles.controlSm : styles.controlMd}`}
            aria-invalid={!!error}
            aria-describedby={describedBy}
          />
        );
      })();
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {control}
      {hint && (
        <span id={`${id}-hint`} className={styles.fieldHint}>
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className={styles.fieldError}>
          {error}
        </span>
      )}
    </div>
  );
}
