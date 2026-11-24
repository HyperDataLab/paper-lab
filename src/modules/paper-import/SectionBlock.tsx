import { ChevronDown, Play } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';
import type { StaleReason } from '@/core/runFreshness';
import { describeStale } from './paperJobs';
import type { ReactNode } from 'react';
import { Badge } from '@/shared/ui/Badge';
import { ActionMenu } from '@/shared/ui/ActionBar';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { CRITERIA, type Criterion } from './criteria';
import { PAPER_LABELS } from './labels';
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
  stale,
  estimate,
  budget,
  onRun,
  sectionRun,
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
  stale?: StaleReason[] | null;
  estimate?: number;
  budget?: number;
  /** Starts the analysis with the remembered scope and the ceiling from Settings. */
  onRun?: () => void;
  /** Running this analysis for one section and merging it into the result it already has. */
  sectionRun?: {
    sections: { id: string; label: string; estimate: number }[];
    onRun: (sectionId: string) => void;
  };
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
          <h2 title={help}>{title}</h2>
        </div>
        {stale && <Badge tone="warning">Kết quả cũ ({describeStale(stale)})</Badge>}
        {/* Only a run in progress is worth a label: not-run shows its run button, done shows its content. */}
        {status === 'running' && <Badge tone={STATUS.running.tone}>{STATUS.running.label}</Badge>}
        {onRun && (
          <div className={styles.blockRun}>
            <Button size="sm" onClick={onRun}>
              <Play size={14} aria-hidden="true" />
              {PAPER_LABELS.analyze}
            </Button>
            {estimate !== undefined && (
              <span className={styles.muted}>
                ~{estimate} lượt{budget !== undefined && ` · trần ${budget}`}
              </span>
            )}
          </div>
        )}
        <IconButton
          size="sm"
          aria-expanded={open}
          label={`${open ? 'Thu gọn' : 'Mở'} ${title}`}
          className={styles.blockToggle}
          data-open={open}
          onClick={onToggle}
        >
          <ChevronDown size={18} />
        </IconButton>
      </div>
      <div hidden={!open} className={styles.blockBody}>
        <p className={styles.blockHelp}>{help}</p>
        {(sectionRun || (views.length > 1 && view && onView)) && (
          <div className={styles.blockTools}>
            {sectionRun && (
              <ActionMenu
                label={PAPER_LABELS.runSection}
                items={sectionRun.sections.map((choice) => ({
                  label: `${choice.label} (~${choice.estimate} lượt)`,
                  onSelect: () => sectionRun.onRun(choice.id),
                }))}
              />
            )}
            {views.length > 1 && view && onView && (
              <SegmentedControl
                label={`Nội dung của ${title}`}
                value={view}
                options={views.map((item) => ({ value: item.id, label: item.label }))}
                onChange={onView}
              />
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
