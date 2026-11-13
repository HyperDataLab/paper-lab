import type { Paper } from '@/core/schemas';
import { ArrowUpRight } from 'lucide-react';
import { placeOf } from './paperLabels';
import styles from './page.module.css';

/**
 * Where a passage is, at a glance: the kind of section as a coloured badge, then the page. The full heading
 * shows on hover. Used inside the buttons that open the passage.
 */
export function PlaceText({ paper, paragraphId }: { paper: Paper; paragraphId: string }) {
  const place = placeOf(paper, paragraphId);
  if (!place) return <>Không rõ vị trí</>;
  return (
    <span
      className={styles.place}
      title={[place.heading, place.page ? `trang ${place.page}` : null].filter(Boolean).join(' · ')}
    >
      <span className={styles.section} data-role={place.role}>
        {place.label}
      </span>
      {place.page ? (
        <>
          {' '}
          · Tr. {place.page} <ArrowUpRight size={12} aria-hidden="true" />
        </>
      ) : (
        ''
      )}
    </span>
  );
}
