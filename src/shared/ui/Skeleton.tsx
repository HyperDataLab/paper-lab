import type { CSSProperties } from 'react';
import styles from './ui.module.css';

/** One placeholder block, as shadcn/ui draws it: a rounded muted shape that pulses while content loads. */
export function SkeletonBlock({
  width,
  height,
  round = false,
}: {
  width?: string;
  height?: string;
  round?: boolean;
}) {
  const style: CSSProperties = { width, height };
  return <span className={`${styles.skeletonBlock} ${round ? styles.skeletonRound : ''}`} style={style} />;
}

/** The shape of a page while it loads: a title, a line under it and three blocks of content. */
export function Skeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-label="Đang tải">
      <SkeletonBlock width="28%" height="28px" />
      <SkeletonBlock width="52%" height="14px" />
      <span className={styles.skeletonGrid}>
        <SkeletonBlock height="112px" />
        <SkeletonBlock height="112px" />
        <SkeletonBlock height="112px" />
      </span>
      <SkeletonBlock height="220px" />
    </div>
  );
}
