import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ActionMenu } from './ActionBar';
import styles from './ui.module.css';

/**
 * One saved thing in a grid of its kind (a project, a corpus): what it is, what it is about, its key numbers,
 * how far along it is and its quick actions. The title link covers the card, so the whole card opens it; the
 * actions menu sits above that link, because a button may not live inside a link.
 */
export function ItemCard({
  to,
  icon,
  title,
  description,
  badges,
  stats,
  progress,
  footer,
  actions,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  description?: string;
  badges?: ReactNode;
  stats: { label: string; value: number | string }[];
  progress?: { value: number; max: number; label: string };
  footer: ReactNode;
  actions?: { label: string; onSelect: () => void; danger?: boolean }[];
}) {
  const percent = progress && progress.max > 0 ? Math.round((progress.value / progress.max) * 100) : 0;
  return (
    <article className={styles.itemCard}>
      <div className={styles.itemHead}>
        <span className={styles.itemIcon} aria-hidden="true">
          {icon}
        </span>
        <span className={styles.itemBadges}>
          {badges}
          {actions && actions.length > 0 && (
            <span className={styles.itemActions}>
              <ActionMenu icon label={`Thao tác với ${title}`} items={actions} />
            </span>
          )}
        </span>
      </div>
      <Link to={to} className={styles.itemTitle}>
        {title}
      </Link>
      <span className={styles.itemDescription}>{description || 'Chưa có research question nào.'}</span>
      <span className={styles.itemStats}>
        {stats.map((stat) => (
          <span key={stat.label}>
            <strong>{stat.value}</strong>
            <small>{stat.label}</small>
          </span>
        ))}
      </span>
      {progress && (
        <span className={styles.itemProgress}>
          <span
            role="progressbar"
            aria-label={progress.label}
            aria-valuenow={progress.value}
            aria-valuemin={0}
            aria-valuemax={progress.max}
          >
            <span style={{ width: `${percent}%` }} />
          </span>
          <small>{progress.label}</small>
        </span>
      )}
      <span className={styles.itemFoot}>{footer}</span>
    </article>
  );
}

/** The grid ItemCards sit in: three columns, two on tablets, one on phones. */
export function ItemGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul className={styles.itemGrid} aria-label={label}>
      {children}
    </ul>
  );
}
