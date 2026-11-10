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
const STATUS: Record<FindingStatus, string> = {
  open: 'Cần duyệt',
  confirmed: 'Đã xác nhận',
  dismissed: 'Đã bỏ qua',
};
const STATUS_IDS = Object.keys(STATUS) as FindingStatus[];
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
}) {
  // Sentence-level writing issues can outnumber everything else, so they start switched off when there is
  // anything else. Until the reader touches the chips the default follows the findings as they load.
  const [chosen, setCriteria] = useState<Criterion[] | null>(null);
  const criteria =
    chosen ??
    (findings.some((item) => item.criterion !== 'writing')
      ? CRITERION_IDS.filter((id) => id !== 'writing')
      : CRITERION_IDS);
  const [statuses, setStatuses] = useState<FindingStatus[]>(['open', 'confirmed']);
  const [section, setSection] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const [groupBy, setGroupBy] = useState('type');
  const [applied, setApplied] = useState<string | null>(null);
  if (focusId && focusId !== applied) {
    setApplied(focusId);
    const target = findings.find((item) => item.id === focusId);
    if (target) {
      if (!criteria.includes(target.criterion)) setCriteria([...criteria, target.criterion]);
      setStatuses((old) => (old.includes(target.status) ? old : [...old, target.status]));
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
    (item) => criteria.includes(item.criterion) && statuses.includes(item.status) && inSection(item),
  );
  const group = (item: PaperFinding) => GROUPS.findIndex((entry) => entry.id === item.criterion);
  const shown =
    groupBy === 'type'
      ? filtered
          .map((item, position) => ({ item, position }))
          .sort(
            (a, b) =>
              group(a.item) - group(b.item) ||
              Number(a.item.status !== 'open') - Number(b.item.status !== 'open') ||
              SEVERITY[a.item.severity].rank - SEVERITY[b.item.severity].rank ||
              a.position - b.position,
          )
          .map(({ item }) => item)
      : filtered;
  const toReview = findings.filter((item) => item.status === 'open').length;
  const counts = useMemo(() => countBySection(findings), [findings]);
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
      {toReview > 0 && (
        <p className={styles.reviewNotice} role="status">
          <strong>{toReview} phát hiện cần bạn duyệt.</strong>
          <Button
            size="sm"
            onClick={() => {
              setStatuses(['open']);
              setCriteria(CRITERION_IDS);
              setSection('all');
            }}
          >
            Chỉ hiện mục cần duyệt
          </Button>
        </p>
      )}
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
        {CRITERION_IDS.map((id) => (
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
        {STATUS_IDS.map((id) => (
          <Chip
            key={id}
            aria-pressed={statuses.includes(id)}
            count={findings.filter((item) => item.status === id).length}
            onClick={() => setStatuses(toggle(statuses, id))}
          >
            {STATUS[id]}
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
                {CRITERION_IDS.map((id) => (
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
                  {CRITERION_IDS.map((id) => {
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
                                setStatuses(STATUS_IDS);
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
        Đang hiện {Math.min(shown.length, limit)}/{shown.length} phát hiện (tổng {findings.length}). Mỗi phát
        hiện là ứng viên từ AI hoặc từ quy tắc; bạn là người quyết định.
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
                    <span className={styles.groupCount}>
                      {
                        findings.filter((item) => item.criterion === entry.id && item.status === 'open')
                          .length
                      }{' '}
                      cần duyệt / {findings.filter((item) => item.criterion === entry.id).length}
                    </span>
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
                state={finding.status}
                labels={
                  <>
                    <CriterionMark criterion={finding.criterion} />
                    <strong>{findingTitle(finding)}</strong>
                    <Badge tone={SEVERITY[finding.severity].tone}>{SEVERITY[finding.severity].label}</Badge>
                    <Badge tone={finding.origin === 'ai' ? 'accent' : 'neutral'}>
                      {finding.origin === 'ai' ? 'AI' : 'Rule'}
                    </Badge>
                    {finding.status !== 'open' && (
                      <Badge tone={finding.status === 'confirmed' ? 'success' : 'neutral'}>
                        {STATUS[finding.status]}
                      </Badge>
                    )}
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
                      decided={finding.status !== 'open'}
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
