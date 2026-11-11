import { useEffect, useMemo, useState } from 'react';
import {
  countBySection,
  type Criterion,
  type FindingLocation,
  type FindingStatus,
  type PaperFinding,
} from '@/core/paperFindings';
import type { Paper } from '@/core/schemas';
import { sliceCp } from '@/core/text/offsets';
import { ActionMenu } from '@/shared/ui/ActionBar';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Chip } from '@/shared/ui/Chip';
import { FindingCard, ReviewActions } from '@/shared/ui/FindingCard';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { Select } from '@/shared/ui/Select';
import { Empty } from '@/shared/ui/StateNote';
import { CRITERIA } from './criteria';
import { findingTitle } from './findingTitle';
import { placeLabel } from './paperLabels';
import { CriterionMark } from './SectionBlock';
import styles from './page.module.css';

const CRITERION_IDS = Object.keys(CRITERIA) as Criterion[];
/** A result counts as accepted unless a person rejected it; an older explicit confirmation is accepted too. */
type Verdict = 'accepted' | 'rejected';
const VERDICT: Record<Verdict, string> = { accepted: 'Chấp nhận', rejected: 'Đã bác bỏ' };
const VERDICT_IDS = Object.keys(VERDICT) as Verdict[];
const verdictOf = (status: FindingStatus): Verdict => (status === 'dismissed' ? 'rejected' : 'accepted');
const SEVERITY = {
  high: { label: 'High', tone: 'danger', rank: 0 },
  medium: { label: 'Medium', tone: 'warning', rank: 1 },
  low: { label: 'Low', tone: 'neutral', rank: 2 },
} as const;
/** The groups of the list, by the kind of problem, in the order a reader of a paper weighs them. */
const GROUPS: { id: Criterion; label: string }[] = [
  { id: 'claim', label: 'Claims & reasoning' },
  { id: 'evidence', label: 'Evidence & data' },
  { id: 'context', label: 'Sources & citations' },
  { id: 'writing', label: 'Writing' },
];
const PAGE = 30;
const WHOLE = '__paper';

/**
 * Every issue found in the paper in one list and one card shape, whatever analysis found it. Filters are
 * chips with counts; the table of sections by criteria is a way to filter, not a screen of its own.
 */
export function FindingsList({
  paper,
  findings,
  focusId,
  onLocation,
  onOpenSource,
  onDecide,
  sectionRuns = [],
  only,
}: {
  paper: Paper;
  findings: PaperFinding[];
  /** A finding opened from its mark on the paper: filters are widened so it shows, and it is scrolled to. */
  focusId: string | null;
  onLocation: (location: FindingLocation) => void;
  onOpenSource: (view: string) => void;
  /** Records a person's decision in the source that found it. */
  onDecide: (finding: PaperFinding, status: FindingStatus) => void;
  /** Analyses that can be run for one section and merged into what they found, by criterion. */
  sectionRuns?: {
    criterion: Criterion;
    label: string;
    sections: { id: string; estimate: number }[];
    run: (sectionId: string) => void;
  }[];
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
  // Rejected cards stay in the list, dimmed and with undo; the chip hides them.
  const [statuses, setStatuses] = useState<Verdict[]>(VERDICT_IDS);
  const [section, setSection] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const [groupBy, setGroupBy] = useState('type');
  const [applied, setApplied] = useState<string | null>(null);
  if (focusId && focusId !== applied) {
    setApplied(focusId);
    const target = findings.find((item) => item.id === focusId);
    if (target) {
      if (!criteria.includes(target.criterion)) setCriteria([...criteria, target.criterion]);
      setStatuses((old) =>
        old.includes(verdictOf(target.status)) ? old : [...old, verdictOf(target.status)],
      );
      setSection('all');
      setLimit(findings.length);
    }
  }
  useEffect(() => {
    if (focusId) document.getElementById(`finding-${focusId}`)?.scrollIntoView?.({ block: 'center' });
  }, [focusId, applied]);

  const inSection = (item: PaperFinding) =>
    section === 'all' || (section === WHOLE ? item.sectionId === null : item.sectionId === section);
  const filtered = findings.filter(
    (item) =>
      criteria.includes(item.criterion) && statuses.includes(verdictOf(item.status)) && inSection(item),
  );
  const group = (item: PaperFinding) => GROUPS.findIndex((entry) => entry.id === item.criterion);
  const shown =
    groupBy === 'type'
      ? filtered
          .map((item, position) => ({ item, position }))
          .sort(
            (a, b) =>
              group(a.item) - group(b.item) ||
              SEVERITY[a.item.severity].rank - SEVERITY[b.item.severity].rank ||
              a.position - b.position,
          )
          .map(({ item }) => item)
      : filtered;
  const counts = useMemo(() => countBySection(findings), [findings]);
  /** How many of a kind there are, and how many of them the reader rejected. */
  const groupCount = (criterion: Criterion) => {
    const all = findings.filter((item) => item.criterion === criterion);
    const rejected = all.filter((item) => item.status === 'dismissed').length;
    return rejected > 0 ? `${all.length - rejected} · ${rejected} đã bác bỏ` : String(all.length);
  };
  const cell = (sectionId: string | null, criterion: Criterion) =>
    counts.find((item) => item.sectionId === sectionId && item.criterion === criterion)?.count ?? 0;
  const runnable = new Set(sectionRuns.flatMap((item) => item.sections.map((choice) => choice.id)));
  const rows = [
    ...paper.sections
      .filter((item) => counts.some((count) => count.sectionId === item.id) || runnable.has(item.id))
      .map((item) => ({ id: item.id as string | null, label: item.heading })),
    ...(counts.some((count) => count.sectionId === null) ? [{ id: null, label: 'Cả bài' }] : []),
  ];
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  if (findings.length === 0 && sectionRuns.length === 0)
    return (
      <Empty
        title="Chưa có phát hiện nào."
        hint="Chạy Automated checks bên dưới, hoặc Phân tích toàn bài ở cột bài báo."
      />
    );
  const visible = shown.slice(0, limit);
  return (
    <section className={styles.findings} aria-label="Issues">
      <SegmentedControl
        label="Group by"
        value={groupBy}
        options={[
          { value: 'type', label: 'Type' },
          { value: 'section', label: 'Section' },
        ]}
        onChange={setGroupBy}
      />
      <div className={styles.blockChips} role="group" aria-label="Filter by criterion">
        {ids.map((id) => (
          <Chip
            key={id}
            aria-pressed={criteria.includes(id)}
            count={findings.filter((item) => item.criterion === id).length}
            onClick={() => setCriteria(toggle(criteria, id))}
          >
            <CriterionMark criterion={id} />
            {CRITERIA[id].label}
          </Chip>
        ))}
      </div>
      <div className={styles.blockChips} role="group" aria-label="Filter by status">
        {VERDICT_IDS.map((id) => (
          <Chip
            key={id}
            aria-pressed={statuses.includes(id)}
            count={findings.filter((item) => verdictOf(item.status) === id).length}
            onClick={() => setStatuses(toggle(statuses, id))}
          >
            {VERDICT[id]}
          </Chip>
        ))}
        <Select label="Mục" size="sm" value={section} onChange={(event) => setSection(event.target.value)}>
          <option value="all">Mọi mục</option>
          {rows.map((row) => (
            <option key={row.id ?? WHOLE} value={row.id ?? WHOLE}>
              {row.label}
            </option>
          ))}
        </Select>
      </div>
      <details className={styles.matrix}>
        <summary>Sections × criteria</summary>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th scope="col">Mục</th>
                {ids.map((id) => (
                  <th key={id} scope="col">
                    <CriterionMark criterion={id} /> {CRITERIA[id].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id ?? WHOLE}>
                  <th scope="row">{row.label}</th>
                  {ids.map((id) => {
                    const count = cell(row.id, id);
                    const runs = row.id
                      ? sectionRuns.flatMap((item) => {
                          const choice =
                            item.criterion === id && item.sections.find((option) => option.id === row.id);
                          return choice ? [{ item, choice }] : [];
                        })
                      : [];
                    return (
                      <td key={id}>
                        <div className={styles.cellRow}>
                          {count === 0 ? (
                            <span className={styles.muted}>—</span>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`${count} phát hiện ${CRITERIA[id].label} ở ${row.label}`}
                              onClick={() => {
                                setSection(row.id ?? WHOLE);
                                setCriteria([id]);
                                setStatuses(VERDICT_IDS);
                              }}
                            >
                              {count}
                            </Button>
                          )}
                          {runs.length > 0 && row.id && (
                            <ActionMenu
                              icon
                              label={`Chạy cho mục ${row.label}: ${CRITERIA[id].label}`}
                              items={runs.map(({ item, choice }) => ({
                                label: `${item.label} cho mục này (~${choice.estimate} lượt)`,
                                onSelect: () => item.run(choice.id),
                              }))}
                            />
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className={styles.muted} role="status">
        Đang hiện {Math.min(shown.length, limit)}/{shown.length} phát hiện (tổng {findings.length}). Phát hiện
        do AI hoặc quy tắc tạo ra được chấp nhận mặc định; bấm Bác bỏ với phát hiện bạn thấy không đúng.
      </p>
      {shown.length === 0 && (
        <Empty title="Không có phát hiện nào khớp bộ lọc." hint="Bật thêm tiêu chí hoặc trạng thái." />
      )}
      {visible.map((finding, index) => {
        const first = finding.locations[0];
        const paragraph = first && paper.paragraphs.find((item) => item.id === first.paragraphId);
        const previous = visible[index - 1];
        const entry = GROUPS[group(finding)];
        const heading =
          groupBy === 'type'
            ? index === 0 || previous?.criterion !== finding.criterion
              ? entry && (
                  <>
                    <CriterionMark criterion={entry.id} /> {entry.label}{' '}
                    <span className={styles.groupCount}>{groupCount(entry.id)}</span>
                  </>
                )
              : null
            : index === 0 || previous?.sectionId !== finding.sectionId
              ? (paper.sections.find((item) => item.id === finding.sectionId)?.heading ?? 'Cả bài')
              : null;
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
                    <Badge tone={SEVERITY[finding.severity].tone}>{SEVERITY[finding.severity].label}</Badge>
                    <Badge tone={finding.origin === 'ai' ? 'accent' : 'neutral'}>
                      {finding.origin === 'ai' ? 'AI' : 'Rule'}
                    </Badge>
                    {finding.status === 'dismissed' && <Badge tone="neutral">{VERDICT.rejected}</Badge>}
                  </>
                }
                quote={quote}
                source={
                  first
                    ? { label: placeLabel(paper, first.paragraphId), onOpen: () => onLocation(first) }
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
