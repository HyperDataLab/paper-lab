import type { ReactNode } from 'react';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { CRITERIA, type Criterion } from './criteria';
import styles from './page.module.css';

/** The criterion's mark: a letter in its colour and shape, so colour is never the only signal. */
export function CriterionMark({ criterion }: { criterion: Criterion }) {
  return (
    <span
      className={styles.critMark}
      data-criterion={criterion}
      title={CRITERIA[criterion].label}
      aria-hidden="true"
    >
      {CRITERIA[criterion].letter}
    </span>
  );
}

export type BlockStatus = 'loading' | 'todo' | 'running' | 'done';
const STATUS: Record<BlockStatus, { label: string; tone: 'neutral' | 'accent' | 'success' }> = {
  loading: { label: 'Đang tải', tone: 'neutral' },
  todo: { label: 'Chưa chạy', tone: 'neutral' },
  running: { label: 'Đang chạy', tone: 'accent' },
  done: { label: 'Đã có kết quả', tone: 'success' },
};

/**
 * One analysis on the paper page: a single row saying what it answers and where it stands, with its
 * content folded underneath. An analysis that has not run is this row and a run button, not an empty card.
 * The children stay mounted while folded, so a run in progress is not interrupted.
 */
export function SectionBlock({
  id,
  title,
  help,
  criterion,
  status,
  estimate,
  onRun,
  open,
  onToggle,
  views = [],
  view,
  onView,
  children,
}: {
  id: string;
  title: string;
  help: string;
  criterion: Criterion;
  /** Absent for content that needs no AI run. */
  status?: BlockStatus;
  estimate?: number;
  /** Starts the analysis with the remembered scope and the ceiling from Settings. */
  onRun?: () => void;
  open: boolean;
  onToggle: () => void;
  /** Two readings of the same analysis, when it has them. */
  views?: { id: string; label: string }[];
  view?: string;
  onView?: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <section id={`block-${id}`} className={styles.block} aria-label={title}>
      <div className={styles.blockHead}>
        <CriterionMark criterion={criterion} />
        <div className={styles.blockTitle}>
          <h2>{title}</h2>
          <p>{help}</p>
        </div>
        {status && <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>}
        {onRun && (
          <Button size="sm" variant="primary" onClick={onRun}>
            Phân tích{estimate ? ` (~${estimate} lượt)` : ''}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          aria-label={`${open ? 'Thu gọn' : 'Mở'} ${title}`}
          onClick={onToggle}
        >
          {open ? 'Thu gọn' : status === 'todo' ? 'Tuỳ chọn' : 'Mở'}
        </Button>
      </div>
      <div hidden={!open} className={styles.blockBody}>
        {views.length > 1 && view && onView && (
          <SegmentedControl
            label={`Nội dung của ${title}`}
            value={view}
            options={views.map((item) => ({ value: item.id, label: item.label }))}
            onChange={onView}
          />
        )}
        {children}
      </div>
    </section>
  );
}
