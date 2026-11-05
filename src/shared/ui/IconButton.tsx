import type { ButtonHTMLAttributes } from 'react';
import { Button } from './Button';
import styles from './ui.module.css';
export function IconButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button className={`${styles.iconButton} ${className}`} {...props} />;
}
