import { useEffect, useState } from 'react';
import type { Criterion, FindingLocation, FindingStatus, PaperFinding } from '@/core/paperFindings';
import type { Paper } from '@/core/schemas';
import { sliceCp } from '@/core/text/offsets';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Chip } from '@/shared/ui/Chip';
import { FindingCard, ReviewActions } from '@/shared/ui/FindingCard';
import { Empty } from '@/shared/ui/StateNote';
import { CRITERIA } from './criteria';
import { findingTitle } from './findingTitle';
import { CriterionMark } from './SectionBlock';
import styles from './page.module.css';
import { PlaceText } from './PlaceText';

const CRITERION_IDS = Object.keys(CRITERIA) as Criterion[];
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;
/** The groups of the list, by the kind of problem, in the order a reader of a paper weighs them. */
const GROUPS: { id: Criterion; label: string }[] = [
  { id: 'claim', label: 'Claims & reasoning' },
  { id: 'evidence', label: 'Evidence & data' },
  { id: 'context', label: 'Sources & citations' },
  { id: 'writing', label: 'Writing' },
];
const PAGE = 30;

/**
 * Every issue found in the paper in one list and one card shape, whatever analysis found it. The only filter
 * is the kind of problem. A result counts as accepted unless the reader rejects it; a rejected card stays in
 * place, dimmed, with undo.
 */
export function FindingsList({
  paper,
  findings,
  focusId,
  onLocation,
  onOpenSource,
  onDecide,
  only,
}: {
  paper: Paper;
  findings: PaperFinding[];
  /** A finding opened from its mark on the paper: its kind is switched on, and it is scrolled to. */
  focusId: string | null;
  onLocation: (location: FindingLocation) => void;
  onOpenSource: (view: string) => void;
  /** Records a person's decision in the source that found it. */
  onDecide: (finding: PaperFinding, status: FindingStatus) => void;
  /** The criteria this list is about, when it sits in a space or tab about them. */
  only?: Criterion[];
}) {
  const ids = only ?? CRITERION_IDS;
  // Sentence-level writing issues can outnumber everything else, so they start switched off when there is
  // anything else. Until the reader touches the chips the default follows the findings as they load.
  const [chosen, setCriteria] = useState<Criterion[] | null>(null);
  const criteria =
    chosen ??
    (findings.some((item) => item.criterion !== 'writing') ? ids.filter((id) => id !== 'writing') : ids);
  const [limit, setLimit] = useState(PAGE);
  const [applied, setApplied] = useState<string | null>(null);
  if (focusId && focusId !== applied) {
    setApplied(focusId);
    const target = findings.find((item) => item.id === focusId);
    if (target) {
      if (!criteria.includes(target.criterion)) setCriteria([...criteria, target.criterion]);
      setLimit(findings.length);
    }
  }
  useEffect(() => {
    if (focusId) document.getElementById(`finding-${focusId}`)?.scrollIntoView?.({ block: 'center' });
  }, [focusId, applied]);

  const group = (item: PaperFinding) => GROUPS.findIndex((entry) => entry.id === item.criterion);
  const shown = findings
    .map((item, position) => ({ item, position }))
    .filter(({ item }) => criteria.includes(item.criterion))
    .sort(
      (a, b) =>
        group(a.item) - group(b.item) ||
        SEVERITY_RANK[a.item.severity] - SEVERITY_RANK[b.item.severity] ||
        a.position - b.position,
    )
    .map(({ item }) => item);
  /** How many of a kind there are, and how many of them the reader rejected. */
  const groupCount = (criterion: Criterion) => {
    const all = findings.filter((item) => item.criterion === criterion);
    const rejected = all.filter((item) => item.status === 'dismissed').length;
    return rejected > 0 ? `${all.length - rejected} · ${rejected} đã bác bỏ` : String(all.length);
  };
  const toggle = (id: Criterion) =>
    setCriteria(criteria.includes(id) ? criteria.filter((item) => item !== id) : [...criteria, id]);

  if (findings.length === 0) return <Empty title="Chưa có phát hiện nào." />;
  const visible = shown.slice(0, limit);
  return (
    <section className={styles.findings} aria-label="Issues">
      {ids.length > 1 && (
        <div className={styles.blockChips} role="group" aria-label="Filter by criterion">
          {ids.map((id) => (
            <Chip
              key={id}
              aria-pressed={criteria.includes(id)}
              count={findings.filter((item) => item.criterion === id).length}
              onClick={() => toggle(id)}
            >
              <CriterionMark criterion={id} />
              {CRITERIA[id].label}
            </Chip>
          ))}
        </div>
      )}
      {shown.length === 0 && <Empty title="Không có phát hiện nào khớp bộ lọc." hint="Bật thêm tiêu chí." />}
      {visible.map((finding, index) => {
        const first = finding.locations[0];
        const paragraph = first && paper.paragraphs.find((item) => item.id === first.paragraphId);
        const previous = visible[index - 1];
        const entry = GROUPS[group(finding)];
        const heading =
          (index === 0 || previous?.criterion !== finding.criterion) &&
          entry &&
          // A list about one kind of problem needs no heading for it.
          ids.length > 1 ? (
            <>
              <CriterionMark criterion={entry.id} /> {entry.label}{' '}
              <span className={styles.groupCount}>{groupCount(entry.id)}</span>
            </>
          ) : null;
        const quote = paragraph && first ? `“${sliceCp(paragraph.text, first.start, first.end)}”` : undefined;
        return (
          <div key={finding.id} id={`finding-${finding.id}`} className={styles.findingRow}>
            {heading && <h3>{heading}</h3>}
            <div
              className={styles.findingEdge}
              data-criterion={finding.criterion}
              data-focus={finding.id === focusId}
            >
              <FindingCard
                state={finding.status === 'dismissed' ? 'dismissed' : 'confirmed'}
                labels={
                  <>
                    <CriterionMark criterion={finding.criterion} />
                    <strong>{findingTitle(finding)}</strong>
                    {finding.status === 'dismissed' && <Badge tone="neutral">Đã bác bỏ</Badge>}
                  </>
                }
                quote={quote}
                source={
                  first
                    ? {
                        label: <PlaceText paper={paper} paragraphId={first.paragraphId} />,
                        onOpen: () => onLocation(first),
                      }
                    : undefined
                }
                actions={
                  <>
                    <Button size="sm" variant="ghost" onClick={() => onOpenSource(finding.view)}>
                      Chi tiết
                    </Button>
                    <ReviewActions
                      acceptByDefault
                      decided={finding.status === 'dismissed'}
                      onConfirm={() => onDecide(finding, 'confirmed')}
                      onDismiss={() => onDecide(finding, 'dismissed')}
                      onUndo={() => onDecide(finding, 'open')}
                    />
                  </>
                }
              >
                {/* A rule check's evidence is often just the quoted words; saying them twice adds nothing. */}
                {quote === `“${finding.reason}”` ? null : finding.reason}
              </FindingCard>
            </div>
          </div>
        );
      })}
      {shown.length > limit && (
        <Button variant="ghost" onClick={() => setLimit(limit + PAGE)}>
          Hiện thêm {Math.min(PAGE, shown.length - limit)} phát hiện
        </Button>
      )}
    </section>
  );
}
