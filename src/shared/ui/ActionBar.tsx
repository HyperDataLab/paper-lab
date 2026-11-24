import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import styles from './ui.module.css';
import { ActivityStatus } from './ActivityStatus';

/** Status on the left, actions on the right, on every screen that runs something. */
export function ActionBar({
  status,
  children,
  busy = false,
}: {
  status: ReactNode;
  children?: ReactNode;
  busy?: boolean;
}) {
  const statusLabel = isValidElement<{ children?: ReactNode }>(status) ? status.props.children : status;
  return (
    <div className={styles.actionBar}>
      <div className={styles.actionStatus} aria-busy={busy || undefined}>
        {busy ? <ActivityStatus label={statusLabel} /> : status}
      </div>
      <div className={styles.actionButtons}>{children}</div>
    </div>
  );
}

/**
 * Secondary actions of one kind behind a single button, so they do not compete with the main one.
 * With `icon`, the button is a "more" icon named by the label, for menus repeated on every row or column.
 */
export function ActionMenu({
  label,
  items,
  icon = false,
}: {
  label: string;
  items: { label: string; onSelect: () => void; danger?: boolean }[];
  icon?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div ref={root} className={styles.menu}>
      {icon ? (
        <IconButton
          label={label}
          variant="ghost"
          size="sm"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </IconButton>
      ) : (
        <Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          {label} <ChevronDown size={14} aria-hidden="true" />
        </Button>
      )}
      {open && (
        <div role="menu" className={styles.menuList}>
          {items.map((item) => (
            <Button
              key={item.label}
              role="menuitem"
              size="sm"
              variant="ghost"
              className={item.danger ? styles.menuDanger : undefined}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A single number with its meaning. Clickable when it leads somewhere. */
export function Stat({
  value,
  label,
  onClick,
}: {
  value: ReactNode;
  label: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <strong>{value}</strong>
      <span>{label}</span>
    </>
  );
  return onClick ? (
    <Button className={styles.stat} onClick={onClick}>
      {content}
    </Button>
  ) : (
    <div className={styles.stat}>{content}</div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className={styles.statGrid}>{children}</div>;
}
