import { ArrowUpRight, ChevronDown, Filter, RotateCw } from 'lucide-react';
import { IconButton } from '@/shared/ui/IconButton';
import { memo, useEffect, useMemo, useState } from 'react';
import type { Criterion, FindingLocation, FindingStatus, PaperFinding } from '@/core/paperFindings';
import type { Paper } from '@/core/schemas';
import { displayQuote, displayReason } from './findingText';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Chip } from '@/shared/ui/Chip';
import { ReviewActions } from '@/shared/ui/FindingCard';
import { Empty } from '@/shared/ui/StateNote';
import { CRITERIA } from './criteria';
import { findingTitle } from './findingTitle';
import { CriterionMark } from './SectionBlock';
import styles from './page.module.css';
import { PlaceText } from './PlaceText';
import { MathText } from './MathText';

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
const GROUP_RANK = new Map(GROUPS.map((entry, index) => [entry.id, index]));

/**
 * Every issue found in the paper in one list and one card shape, whatever analysis found it. The only filter
 * is the kind of problem. A result counts as accepted unless the reader rejects it; a rejected card stays in
 * place, dimmed, with undo.
 */
export const FindingsList = memo(function FindingsList({
  paper,
  findings,
  focusId,
  onLocation,
  onOpenSource,
  onDecide,
  only,
  onRunChecks,
  idPrefix = '',
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
  onRunChecks?: () => void;
  /** Keeps findings in a preserved hidden tab from sharing DOM ids with the main issue list. */
  idPrefix?: string;
}) {
  const ids = only ?? CRITERION_IDS;
  // Sentence-level writing issues can outnumber everything else, so they start switched off when there is
  // anything else. Until the reader touches the chips the default follows the findings as they load.
  const [chosen, setCriteria] = useState<Criterion[] | null>(null);
  const defaultCriteria = useMemo(
    () =>
      findings.some((item) => item.criterion !== 'writing') ? ids.filter((id) => id !== 'writing') : ids,
    [findings, ids],
  );
  const criteria = chosen ?? defaultCriteria;
  const [limit, setLimit] = useState(PAGE);
  const [byPage, setByPage] = useState(false);
  const [checksOnly, setChecksOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
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
    if (focusId)
      document.getElementById(`finding-${idPrefix}${focusId}`)?.scrollIntoView?.({ block: 'center' });
  }, [focusId, applied, idPrefix]);

  const pageByParagraph = useMemo(
    () => new Map(paper.paragraphs.map((paragraph) => [paragraph.id, paragraph.pageStart ?? Infinity])),
    [paper.paragraphs],
  );
  const shown = useMemo(
    () =>
      findings
        .map((item, position) => ({ item, position }))
        .filter(({ item }) => (checksOnly ? item.source === 'checks' : criteria.includes(item.criterion)))
        .sort(
          (a, b) =>
            (byPage
              ? (pageByParagraph.get(a.item.locations[0]?.paragraphId ?? '') ?? Infinity) -
                (pageByParagraph.get(b.item.locations[0]?.paragraphId ?? '') ?? Infinity)
              : (GROUP_RANK.get(a.item.criterion) ?? Infinity) -
                (GROUP_RANK.get(b.item.criterion) ?? Infinity)) ||
            SEVERITY_RANK[a.item.severity] - SEVERITY_RANK[b.item.severity] ||
            a.position - b.position,
        )
        .map(({ item }) => item),
    [byPage, checksOnly, criteria, findings, pageByParagraph],
  );
  /** How many of a kind there are, and how many of them the reader rejected. */
  const groupCount = (criterion: Criterion) => {
    const all = findings.filter((item) => item.criterion === criterion);
    const rejected = all.filter((item) => item.status === 'dismissed').length;
    return rejected > 0 ? `${all.length - rejected} · ${rejected} đã bác bỏ` : String(all.length);
  };
  const toggle = (id: Criterion) =>
    setCriteria(criteria.includes(id) ? criteria.filter((item) => item !== id) : [...criteria, id]);
  const toggleExpanded = (id: string) =>
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (findings.length === 0 && !onRunChecks) return <Empty title="Chưa có phát hiện nào." />;
  const visible = shown.slice(0, limit);
  return (
    <section className={styles.findings} aria-label="Issues">
      <div className={styles.findingTools} role="group" aria-label="Bộ lọc và sắp xếp">
        <div className={styles.criterionFilter}>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={filtersOpen}
            aria-haspopup="true"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <Filter size={14} aria-hidden="true" />
            Bộ lọc ({criteria.length})
            <ChevronDown size={14} aria-hidden="true" />
          </Button>
          {filtersOpen && (
            <div className={styles.criterionOptions} role="group" aria-label="Lọc theo loại vấn đề">
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
        </div>
        <Chip aria-pressed={byPage} onClick={() => setByPage(!byPage)}>
          Theo trang
        </Chip>
        {onRunChecks && (
          <Chip aria-pressed={checksOnly} onClick={() => setChecksOnly(!checksOnly)}>
            Kiểm tra tự động
          </Chip>
        )}
        {onRunChecks && (
          <Button
            size="sm"
            variant="ghost"
            className={styles.findingToolsEnd}
            leadingIcon={<RotateCw size={14} aria-hidden="true" />}
            onClick={onRunChecks}
          >
            Chạy lại kiểm tra
          </Button>
        )}
      </div>
      {shown.length === 0 && <Empty title="Không có phát hiện nào khớp bộ lọc." hint="Bật thêm tiêu chí." />}
      {visible.map((finding, index) => {
        const first = finding.locations[0];
        const paragraph = first && paper.paragraphs.find((item) => item.id === first.paragraphId);
        const previous = visible[index - 1];
        const entry = GROUPS[GROUP_RANK.get(finding.criterion) ?? -1];
        const heading =
          (index === 0 || previous?.criterion !== finding.criterion) && entry && ids.length > 1 && !byPage ? (
            <h3 className={styles.findingGroupHead}>
              <CriterionMark criterion={entry.id} /> {entry.label}{' '}
              <span className={styles.groupCount}>{groupCount(entry.id)}</span>
            </h3>
          ) : null;
        const quote =
          paragraph && first ? `“${displayQuote(paragraph.text, first.start, first.end)}”` : undefined;
        const open = expanded.has(finding.id);
        return (
          <div key={finding.id} id={`finding-${idPrefix}${finding.id}`} className={styles.findingRow}>
            {heading}
            <div className={styles.compactFinding} data-focus={finding.id === focusId}>
              <div className={styles.compactFindingHead}>
                <IconButton
                  className={styles.findingExpand}
                  label={open ? 'Thu gọn vấn đề' : `Mở rộng ${findingTitle(finding)}`}
                  aria-expanded={open}
                  onClick={() => toggleExpanded(finding.id)}
                >
                  <ChevronDown size={16} aria-hidden="true" />
                </IconButton>
                <CriterionMark criterion={finding.criterion} />
                <strong className={styles.compactFindingTitle}>{findingTitle(finding)}</strong>
                {finding.status === 'dismissed' && <Badge tone="neutral">Đã bác bỏ</Badge>}
                {first && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className={styles.findingPage}
                    onClick={() => onLocation(first)}
                  >
                    {paragraph?.pageStart ? (
                      `Tr. ${paragraph.pageStart}`
                    ) : (
                      <PlaceText paper={paper} paragraphId={first.paragraphId} />
                    )}
                  </Button>
                )}
              </div>
              {open && (
                <div className={styles.compactFindingBody}>
                  {quote && (
                    <blockquote>
                      <MathText text={quote} />
                    </blockquote>
                  )}
                  {finding.code !== 'claim_strength_drift' && quote !== `“${finding.reason}”` && (
                    <p>
                      <MathText text={displayReason(finding.reason) ?? ''} />
                    </p>
                  )}
                  {finding.code === 'claim_strength_drift' &&
                    finding.locations.slice(1).map((location, relatedIndex) => {
                      const related = paper.paragraphs.find((item) => item.id === location.paragraphId);
                      return related ? (
                        <p key={relatedIndex}>
                          Câu liên quan:{' '}
                          <Button size="sm" variant="ghost" onClick={() => onLocation(location)}>
                            “<MathText text={displayQuote(related.text, location.start, location.end)} />”
                          </Button>
                        </p>
                      ) : null;
                    })}
                  <div className={styles.compactFindingActions}>
                    {finding.source !== 'checks' && (
                      <Button size="sm" variant="ghost" onClick={() => onOpenSource(finding.view)}>
                        <ArrowUpRight size={14} aria-hidden="true" /> Chi tiết phân tích
                      </Button>
                    )}
                    <ReviewActions
                      acceptByDefault
                      decided={finding.status === 'dismissed'}
                      onConfirm={() => onDecide(finding, 'confirmed')}
                      onDismiss={() => onDecide(finding, 'dismissed')}
                      onUndo={() => onDecide(finding, 'open')}
                    />
                  </div>
                </div>
              )}
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
});
