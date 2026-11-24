import {
  useId,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type Ref,
  type ReactNode,
} from 'react';
import styles from './ui.module.css';

/** `hideLabel` keeps the label for screen readers only; use it where the control explains itself, as in a toolbar. */
type Common = {
  label: string;
  labelPrefix?: string;
  labelAction?: ReactNode;
  hint?: string;
  error?: string;
  size?: 'md' | 'sm';
  hideLabel?: boolean;
  controlClassName?: string;
};
type Props = Common &
  (
    | ({ multiline?: false; ref?: Ref<HTMLInputElement> } & Omit<
        InputHTMLAttributes<HTMLInputElement>,
        'size'
      >)
    | ({ multiline: true; ref?: Ref<HTMLTextAreaElement> } & TextareaHTMLAttributes<HTMLTextAreaElement>)
  );
export function TextField({
  label,
  labelPrefix,
  labelAction,
  hint,
  error,
  size = 'md',
  hideLabel = false,
  controlClassName = '',
  ...props
}: Props) {
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
            className={`${styles.fieldControl} ${styles.multiline} ${controlClassName}`}
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
            className={`${styles.fieldControl} ${size === 'sm' ? styles.controlSm : styles.controlMd} ${controlClassName}`}
            aria-invalid={!!error}
            aria-describedby={describedBy}
          />
        );
      })();
  return (
    <div className={styles.field}>
      {labelAction ? (
        <div className={styles.fieldLabelRow}>
          <label
            htmlFor={id}
            className={hideLabel ? styles.srOnly : labelPrefix ? styles.fieldLabelWithPrefix : undefined}
          >
            {labelPrefix && (
              <span className={styles.fieldLabelPrefix} aria-hidden="true">
                {labelPrefix}
              </span>
            )}
            {label}
          </label>
          {labelAction}
        </div>
      ) : (
        <label
          htmlFor={id}
          className={hideLabel ? styles.srOnly : labelPrefix ? styles.fieldLabelWithPrefix : undefined}
        >
          {labelPrefix && (
            <span className={styles.fieldLabelPrefix} aria-hidden="true">
              {labelPrefix}
            </span>
          )}
          {label}
        </label>
      )}
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
