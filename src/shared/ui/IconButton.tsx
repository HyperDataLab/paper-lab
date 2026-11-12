import type { ComponentProps } from 'react';
import { Button } from './Button';
import { Tooltip } from './Tooltip';
import styles from './ui.module.css';

/**
 * An action shown as its icon, named by a tooltip and by its accessible label. The icon carries the meaning
 * in colour as well as shape: accent for doing something, danger for removing or rejecting, neutral otherwise.
 */
export function IconButton({
  className = '',
  label,
  tone = 'neutral',
  tooltipSide = 'top',
  variant = 'ghost',
  ...props
}: ComponentProps<typeof Button> & {
  label: string;
  tone?: 'neutral' | 'accent' | 'danger';
  tooltipSide?: 'top' | 'right';
}) {
  return (
    <Tooltip label={label} side={tooltipSide}>
      <Button
        aria-label={label}
        variant={variant}
        className={`${styles.iconButton} ${styles[`icon_${tone}`] ?? ''} ${className}`}
        {...props}
      />
    </Tooltip>
  );
}
