import type { ReactNode } from 'react';
import styles from './ui.module.css';

/**
 * A choice with a title and a line of explanation, picked by clicking anywhere on it: a checkbox row in a list
 * (`variant="row"`) or a bordered card to pick one of (`type="radio"`, `variant="card"`).
 */
export function OptionCard({
  type = 'checkbox',
  variant = 'row',
  name,
  checked,
  disabled = false,
  onChange,
  title,
  description,
}: {
  type?: 'checkbox' | 'radio';
  variant?: 'row' | 'card';
  name?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label
      className={`${styles.option} ${variant === 'card' ? styles.optionCard : ''}`}
      data-checked={checked}
      data-disabled={disabled || undefined}
    >
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </span>
    </label>
  );
}
