import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Issue, TextAnalysis } from '@/core/schemas';
import { createOffsetIndex } from '@/core/text';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Drawer } from '@/shared/ui/Drawer';
import { ReviewActions } from '@/shared/ui/FindingCard';
import { Tabs } from '@/shared/ui/Tabs';
import { IconButton } from '@/shared/ui/IconButton';
import { Checkbox } from '@/shared/ui/Checkbox';
import { Chip } from '@/shared/ui/Chip';
import { Select } from '@/shared/ui/Select';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { useToast } from '@/shared/ui/toastContext';
import { labels, statuses } from './issueLabels';
import { DEFAULT_LEXICON } from '@/core/detectors';
import { SV_GAP_REVIEW, CLAUSE_DEPTH_REVIEW } from '@/core/analysis/heuristics';
import { CheckCircle2, CircleDot, XCircle, MinusCircle, Sparkles, Copy } from 'lucide-react';
import { Badge } from '@/shared/ui/Badge';
import styles from './review.module.css';
import { roleLabels } from './roleLabels';
import type { useParagraphAnalysis } from './useParagraphAnalysis';
import { CalibrationBadge } from '@/shared/calibration/CalibrationBadge';
import { calibrationStatus } from '@/core/calibration';
import type { CalibrationData } from '@/shared/calibration/data';

const categories: Record<Issue['category'], string> = {
  structure: 'Cấu trúc câu',
  flow: 'Mạch',
  word: 'Từ ngữ',
  organization: 'Tổ chức đoạn',
  critical: 'Rủi ro ý nghĩa',
};
const severities: Record<Issue['severity'], string> = {
  info: 'Thông tin',
  minor: 'Nhỏ',
  moderate: 'Vừa',
  major: 'Lớn',
  critical: 'Nghiêm trọng',
};
const handled = (i: Issue) => i.status === 'confirmed_by_human' || i.status === 'dismissed_by_human';

export function ReviewWorkspace({
  text,
  issues,
  onChange,
  toolbarTarget,
  roles,
  selectedIssue,
  revisionSelection,
  onRevisionSelection,
  calibrationStats,
}: {
  text: TextAnalysis;
  issues: Issue[];
  onChange: (issue: Issue, change: { status?: Issue['status']; severity?: Issue['severity'] }) => void;
  toolbarTarget?: HTMLElement | null;
  roles?: NonNullable<ReturnType<typeof useParagraphAnalysis>['result']>['roles'];
  selectedIssue?: { id: string; nonce: number } | null;
  revisionSelection?: string[];
  onRevisionSelection?: (id: string, selected: boolean) => void;
  calibrationStats?: CalibrationData['stats'];
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [category, setCategory] = useState<Issue['category'] | null>(null);
  const [filter, setFilter] = useState('all');
  const [low, setLow] = useState(false);
  const [hideUnreliable, setHideUnreliable] = useState(false);
  const statsFor = (type: string) =>
    calibrationStats?.find((row) => row.kind === 'issue' && row.type === type);
  const [done, setDone] = useState(false);
  const [previousSelection, setPreviousSelection] = useState<typeof selectedIssue>(null);
  if (selectedIssue !== previousSelection) {
    setPreviousSelection(selectedIssue);
    const issue = issues.find((item) => item.id === selectedIssue?.id);
    if (issue) {
      setSelected(issue.id);
      setDone(handled(issue));
    }
  }
  const [hovered, setHovered] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const reading = useRef<HTMLDivElement>(null);
  const [connector, setConnector] = useState<string | null>(null);
  useEffect(() => {
    const update = () => {
      const root = reading.current;
      const issue = issues.find(
        (item) => item.id === selected && item.category === 'flow' && item.spans.length === 2,
      );
      if (!root || !issue) {
        setConnector(null);
        return;
      }
      const marks = Array.from(root.querySelectorAll<HTMLElement>('[data-issues]')).filter((mark) =>
        mark.dataset.issues?.split('|').includes(issue.id),
      );
      const first = marks[0]?.getClientRects()[0];
      const last = marks.at(-1)?.getClientRects()[0];
      if (!first || !last || marks.length < 2) {
        setConnector(null);
        return;
      }
      const rect = root.getBoundingClientRect();
      const x1 = first.right - rect.left,
        y1 = first.bottom - rect.top;
      const x2 = last.left - rect.left,
        y2 = last.bottom - rect.top;
      setConnector(`M ${x1} ${y1} C ${x1 + 25} ${y1 + 25}, ${x2 - 25} ${y2 + 25}, ${x2} ${y2}`);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [selected, issues]);
  const [tablet, setTablet] = useState(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 1023px)').matches &&
      !window.matchMedia('(max-width: 767px)').matches,
  );
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const medium = window.matchMedia('(max-width: 1023px)');
    const small = window.matchMedia('(max-width: 767px)');
    const update = () => setTablet(medium.matches && !small.matches);
    medium.addEventListener?.('change', update);
    small.addEventListener?.('change', update);
    return () => {
      medium.removeEventListener?.('change', update);
      small.removeEventListener?.('change', update);
    };
  }, []);
  const index = createOffsetIndex(text.sourceText);
  const visible = issues.filter(
    (i) =>
      (!category || i.category === category) &&
      (!low || i.confidence >= 0.5) &&
      (!hideUnreliable ||
        calibrationStatus(statsFor(i.type) ?? { n: 0, wilsonLow: null }) !== 'unreliable') &&
      (filter === 'all' || (filter === 'candidate' ? i.status === 'candidate' : i.status !== 'candidate')),
  );
  const boundaries = [
    ...new Set([
      0,
      index.length,
      ...visible
        .filter((i) => i.status !== 'dismissed_by_human')
        .flatMap((i) => i.spans.flatMap((s) => [s.start, s.end])),
      ...(roles ? text.sentences.map((sentence) => sentence.start) : []),
    ]),
  ]
    .filter((v) => v >= 0 && v <= index.length)
    .sort((a, b) => a - b);
  function select(id: string, target: 'card' | 'mark') {
    setSelected(id);
    if (target === 'mark' && tablet) setDrawerOpen(false);
    if (target === 'card') {
      const item = issues.find((value) => value.id === id);
      if (item) setDone(handled(item));
      if (tablet) setDrawerOpen(true);
    }
    window.setTimeout(
      () =>
        (target === 'mark'
          ? Array.from(document.querySelectorAll<HTMLElement>('[data-issues]')).find((el) =>
              el.dataset.issues?.split('|').includes(id),
            )
          : document.getElementById(`card-${id}`)
        )?.scrollIntoView?.({ block: 'nearest' }),
      0,
    );
  }
  const panel = (
    <Card>
      <div className={styles.panelHead}>
        <h2>Gợi ý</h2>
        <span className={styles.count}>{issues.filter((i) => !handled(i)).length} cần xem</span>
      </div>
      <Tabs label="Trạng thái gợi ý">
        <Button role="tab" aria-selected={!done} onClick={() => setDone(false)}>
          Cần xem ({issues.filter((i) => !handled(i)).length})
        </Button>
        <Button role="tab" aria-selected={done} onClick={() => setDone(true)}>
          Đã xử lý ({issues.filter(handled).length})
        </Button>
      </Tabs>
      <div className={styles.chips}>
        {(Object.keys(categories) as Issue['category'][]).map(
          (c) =>
            issues.some((i) => i.category === c) && (
              <Chip
                className={styles.filterButton}
                aria-pressed={category === c}
                key={c}
                onClick={() => setCategory(category === c ? null : c)}
              >
                {categories[c]} ({issues.filter((i) => i.category === c).length})
              </Chip>
            ),
        )}
      </div>
      <div className={styles.filters}>
        <SegmentedControl
          label="Lọc trạng thái"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Tất cả' },
            { value: 'confirmed', label: 'Đã xác nhận' },
            { value: 'candidate', label: 'Ứng viên' },
          ]}
        />
        <Checkbox checked={low} onChange={(e) => setLow(e.target.checked)}>
          Ẩn độ tin cậy thấp
        </Checkbox>
        <Checkbox checked={hideUnreliable} onChange={(event) => setHideUnreliable(event.target.checked)}>
          Ẩn mục chưa đáng tin
        </Checkbox>
      </div>
      {visible.filter((i) => handled(i) === done).length === 0 && (
        <p className={styles.none}>{issues.length ? 'Đã xem hết gợi ý' : 'Chưa có gợi ý'}</p>
      )}
      <ul
        className={styles.cards}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setSelected(null);
            e.stopPropagation();
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-card]'));
            const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (at >= 0 && buttons.length) {
              e.preventDefault();
              buttons[(at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
            }
          }
        }}
      >
        {visible
          .filter((i) => handled(i) === done)
          .map((i) => {
            const original = i.spans
              .map((s) => index.sliceCp(s.start, s.end))
              .join(i.category === 'flow' ? ' → ' : ' / ');
            const lexical = DEFAULT_LEXICON.wordyPhrases.find(
              (p) => p.type === i.type && p.phrase === original.toLowerCase(),
            );
            const replacement =
              lexical?.replacement ??
              (i.status === 'confirmed_by_model' &&
              i.suggestedFix &&
              !/[.!?]/.test(i.suggestedFix) &&
              i.suggestedFix.split(/\s+/).length <= 8
                ? i.suggestedFix
                : null);
            const suggestion = replacement ?? i.suggestedFix;
            return (
              <li
                key={i.id}
                id={`card-${i.id}`}
                className={`${styles.cardItem} ${styles[`color_${i.category}`]} ${selected === i.id ? styles.expanded : ''} ${hovered === i.id ? styles.hovered : ''} ${i.severity === 'info' ? styles.acceptable : ''} ${i.status === 'dismissed_by_human' ? styles.dismissed : ''}`}
              >
                <Button
                  data-card
                  className={styles.cardButton}
                  onMouseEnter={() => setHovered(i.id)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(i.id)}
                  onBlur={() => setHovered(null)}
                  onClick={() => select(i.id, 'mark')}
                >
                  <span className={styles.cardCategory}>
                    <span className={styles.dot} aria-hidden="true" />
                    {categories[i.category]}
                    {i.category === 'flow' && i.sentenceIds.length === 2 && (
                      <span>· {i.sentenceIds.map((id) => id.toUpperCase()).join(' → ')}</span>
                    )}
                  </span>
                  <strong className={styles.cardQuote}>{original}</strong>
                  {selected !== i.id && (
                    <span className={styles.cardLabel}>
                      {labels[i.type]}
                      {i.severity === 'info' && <span className={styles.aiOk}> · AI: chấp nhận được</span>}
                    </span>
                  )}
                </Button>
                <div className={styles.cardFoot}>
                  {/* "Not calibrated yet" is detail for the open suggestion; a verdict (reliable or not) shows on every card. */}
                  {(selected === i.id ||
                    calibrationStatus(statsFor(i.type) ?? { n: 0, wilsonLow: null }) !== 'uncalibrated') && (
                    <CalibrationBadge stats={statsFor(i.type)} />
                  )}
                  {revisionSelection && onRevisionSelection && (
                    <Checkbox
                      disabled={i.status === 'dismissed_by_human'}
                      checked={i.status !== 'dismissed_by_human' && revisionSelection.includes(i.id)}
                      onChange={(event) => onRevisionSelection(i.id, event.target.checked)}
                    >
                      Chọn để chỉnh sửa
                    </Checkbox>
                  )}
                </div>
                {selected === i.id && (
                  <div className={styles.detail}>
                    <div className={styles.detailHead}>
                      <strong>{labels[i.type]}</strong>
                      <Badge
                        icon={
                          i.status === 'dismissed_by_human' ? (
                            <XCircle size={14} />
                          ) : i.severity === 'info' && !handled(i) ? (
                            <MinusCircle size={14} />
                          ) : i.status === 'candidate' ? (
                            <CircleDot size={14} />
                          ) : i.status === 'confirmed_by_model' ? (
                            <Sparkles size={14} />
                          ) : (
                            <CheckCircle2 size={14} />
                          )
                        }
                      >
                        {i.severity === 'info' && !handled(i) ? 'AI: chấp nhận được' : statuses[i.status]}
                      </Badge>
                    </div>
                    <p className={styles.why}>{i.why}</p>
                    {suggestion && (
                      <p className={styles.suggestion}>
                        {replacement ? (
                          <>
                            <del>{original}</del> → <strong>{replacement}</strong>
                          </>
                        ) : (
                          <>Gợi ý: {suggestion}</>
                        )}
                      </p>
                    )}
                    <p className={styles.metric} title={i.metric.name}>
                      {i.type === 'SUBJECT_VERB_GAP'
                        ? `Khoảng cách chủ–vị: ${i.metric.value} token (ngưỡng thử nghiệm ≥ ${SV_GAP_REVIEW})`
                        : i.type === 'CLAUSE_DEPTH'
                          ? `Độ sâu mệnh đề: ${i.metric.value} (ngưỡng ≥ ${CLAUSE_DEPTH_REVIEW})`
                          : i.metric.name === 'stress_to_next_topic_alignment'
                            ? 'Không nối Stress → Topic'
                            : i.metric.name === 'central_point_identifiability'
                              ? `Mức rõ của ý chính: ${i.metric.value ?? '—'}/4`
                              : i.metric.name === 'off_topic_sentence_count'
                                ? 'Câu lạc đề'
                                : `${i.metric.value ?? '—'} ${i.metric.unit === 'candidate' ? 'ứng viên' : i.metric.unit === 'tokens' ? 'token' : (i.metric.unit ?? '')}`}{' '}
                      · {severities[i.severity]} · {Math.round(i.confidence * 100)}% · {i.sourcePrinciple}
                    </p>
                    <div className={styles.detailFoot}>
                      <Select
                        label="Mức độ"
                        size="sm"
                        inline
                        value={i.severity}
                        onChange={(e) => onChange(i, { severity: e.target.value as Issue['severity'] })}
                      >
                        <option value="minor">Nhỏ</option>
                        <option value="moderate">Vừa</option>
                        <option value="major">Lớn</option>
                        {(i.severity === 'info' || i.severity === 'critical') && (
                          <option value={i.severity}>{severities[i.severity]}</option>
                        )}
                      </Select>
                      <div className={styles.controls}>
                        <ReviewActions
                          decided={done}
                          onConfirm={() => onChange(i, { status: 'confirmed_by_human' })}
                          onDismiss={() => onChange(i, { status: 'dismissed_by_human' })}
                          onUndo={() => onChange(i, { status: 'candidate' })}
                        />
                        {suggestion && (
                          <IconButton
                            label="Sao chép gợi ý"
                            onClick={() => {
                              void navigator.clipboard
                                ?.writeText(suggestion)
                                .then(() => toast('Đã sao chép gợi ý'))
                                .catch(() => {});
                            }}
                          >
                            <Copy size={16} />
                          </IconButton>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
      </ul>
      <p className={styles.footnote}>Đây là ứng viên cần xem xét, không phải lỗi đã khẳng định.</p>
    </Card>
  );
  return (
    <div className={styles.workspace}>
      <div className={styles.readingCard}>
        <div className={styles.reading} ref={reading}>
          {connector && (
            <svg className={styles.connector} aria-hidden="true">
              <defs>
                <marker id="flow-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M 0 0 L 6 3 L 0 6 z" />
                </marker>
              </defs>
              <path d={connector} markerEnd="url(#flow-arrow)" />
            </svg>
          )}
          {boundaries.slice(0, -1).map((start, n) => {
            const end = boundaries[n + 1] ?? start;
            const covering = visible.filter(
              (i) =>
                i.status !== 'dismissed_by_human' && i.spans.some((s) => s.start <= start && s.end >= end),
            );
            const value = index.sliceCp(start, end);
            const sentence = text.sentences.find((item) => item.start === start);
            const role = roles?.find((item) => item.sentenceId === sentence?.id);
            const badge = role ? (
              <span className={styles.role}>
                <span className={styles.srOnly}>Vai trò: </span>
                {roleLabels[role.role]}
              </span>
            ) : null;
            if (!covering.length)
              return (
                <span key={start}>
                  {badge}
                  {value}
                </span>
              );
            const priority: Record<Issue['severity'], number> = {
              info: 0,
              minor: 1,
              moderate: 2,
              major: 3,
              critical: 4,
            };
            const ranked = [...covering].sort((a, b) => priority[b.severity] - priority[a.severity]);
            const issue = ranked[0];
            if (!issue) return null;
            const secondary = ranked[1];
            const secondaryColor = `var(--hl-${secondary?.category === 'organization' ? 'org' : (secondary?.category ?? 'word')})`;
            const activate = () => {
              const position = covering.findIndex((i) => i.id === selected);
              select(covering[(position + 1) % covering.length]?.id ?? issue.id, 'card');
            };
            return (
              <Fragment key={start}>
                {badge}
                <mark
                  style={
                    {
                      '--second-color':
                        secondary?.status === 'candidate'
                          ? `color-mix(in srgb, ${secondaryColor} 60%, transparent)`
                          : secondaryColor,
                    } as CSSProperties
                  }
                  data-issues={covering.map((item) => item.id).join('|')}
                  role="button"
                  tabIndex={0}
                  aria-label={`${labels[issue.type]}, ${severities[issue.severity]}, ${statuses[issue.status]}`}
                  className={`${styles.mark} ${styles[issue.category]} ${styles[issue.severity]} ${covering.length > 1 ? styles.overlap : ''} ${issue.status === 'candidate' ? styles.candidate : ''} ${covering.some((i) => i.id === selected) ? styles.selected : ''} ${covering.some((i) => i.id === hovered) ? styles.hoveredMark : ''}`}
                  onMouseEnter={() => setHovered(issue.id)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(issue.id)}
                  onBlur={() => setHovered(null)}
                  onClick={activate}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      activate();
                    }
                  }}
                >
                  {issue.severity === 'critical' && <span aria-hidden="true">⚠</span>}
                  {value}
                </mark>
                {covering.length > 2 && (
                  <Button
                    type="button"
                    className={styles.overlapBadge}
                    onClick={activate}
                    aria-label={`Thêm ${covering.length - 2} gợi ý chồng lấp`}
                  >
                    +{covering.length - 2}
                  </Button>
                )}
              </Fragment>
            );
          })}
        </div>
        {issues.length > 0 && (
          <ul className={styles.legend} aria-label="Cách đọc gạch chân">
            {(Object.keys(categories) as Issue['category'][])
              .filter((c) => issues.some((i) => i.category === c))
              .map((c) => (
                <li key={c}>
                  <span className={`${styles.legendSample} ${styles[c]}`}>{categories[c]}</span>
                </li>
              ))}
            <li className={styles.legendNote}>Nét đậm: AI đã xác nhận · nét nhạt: ứng viên</li>
          </ul>
        )}
      </div>
      {tablet ? (
        <>
          {toolbarTarget ? (
            createPortal(
              <Button onClick={() => setDrawerOpen(true)}>
                Gợi ý ({issues.filter((i) => !handled(i)).length})
              </Button>,
              toolbarTarget,
            )
          ) : (
            <Button onClick={() => setDrawerOpen(true)}>
              Gợi ý ({issues.filter((i) => !handled(i)).length})
            </Button>
          )}
          <Drawer open={drawerOpen} onClose={closeDrawer} label="Gợi ý" side="right" title="Gợi ý">
            {panel}
          </Drawer>
        </>
      ) : (
        <div className={styles.panel}>{panel}</div>
      )}
    </div>
  );
}
