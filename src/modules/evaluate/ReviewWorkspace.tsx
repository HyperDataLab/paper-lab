import { Fragment, useCallback, useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Issue, TextAnalysis } from '@/core/schemas';
import { createOffsetIndex } from '@/core/text';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Drawer } from '@/shared/ui/Drawer';
import { Tabs } from '@/shared/ui/Tabs';
import { IconButton } from '@/shared/ui/IconButton';
import { Tooltip } from '@/shared/ui/Tooltip';
import { labels } from './issueLabels';
import { DEFAULT_LEXICON } from '@/core/detectors';
import { SV_GAP_REVIEW, CLAUSE_DEPTH_REVIEW } from '@/core/analysis/heuristics';
import { CheckCircle2, Circle, CircleSlash, Copy } from 'lucide-react';
import styles from './review.module.css';

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
const statuses: Record<Issue['status'], string> = {
  candidate: 'Ứng viên cần xem lại',
  confirmed_by_model: 'AI cho là có vấn đề',
  confirmed_by_human: 'Đã xác nhận',
  dismissed_by_human: 'Đã bỏ qua',
};
const handled = (i: Issue) => i.status === 'confirmed_by_human' || i.status === 'dismissed_by_human';

export function ReviewWorkspace({
  text,
  issues,
  onChange,
  toolbarTarget,
}: {
  text: TextAnalysis;
  issues: Issue[];
  onChange: (issue: Issue, change: { status?: Issue['status']; severity?: Issue['severity'] }) => void;
  toolbarTarget?: HTMLElement | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [category, setCategory] = useState<Issue['category'] | null>(null);
  const [filter, setFilter] = useState('all');
  const [low, setLow] = useState(false);
  const [done, setDone] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
      (filter === 'all' || (filter === 'candidate' ? i.status === 'candidate' : i.status !== 'candidate')),
  );
  const boundaries = [
    ...new Set([
      0,
      index.length,
      ...visible
        .filter((i) => i.status !== 'dismissed_by_human')
        .flatMap((i) => i.spans.flatMap((s) => [s.start, s.end])),
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
      <h2>Gợi ý ({issues.filter((i) => !handled(i)).length})</h2>
      <Tabs label="Trạng thái gợi ý">
        <button role="tab" aria-selected={!done} onClick={() => setDone(false)}>
          Cần xem ({issues.filter((i) => !handled(i)).length})
        </button>
        <button role="tab" aria-selected={done} onClick={() => setDone(true)}>
          Đã xử lý ({issues.filter(handled).length})
        </button>
      </Tabs>
      <div className={styles.chips}>
        {(Object.keys(categories) as Issue['category'][]).map(
          (c) =>
            issues.some((i) => i.category === c) && (
              <Button
                className={styles.filterButton}
                aria-pressed={category === c}
                key={c}
                onClick={() => setCategory(category === c ? null : c)}
              >
                {categories[c]} ({issues.filter((i) => i.category === c).length})
              </Button>
            ),
        )}
      </div>
      <div className={styles.segmented}>
        <Button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          Tất cả
        </Button>
        <Button aria-pressed={filter === 'confirmed'} onClick={() => setFilter('confirmed')}>
          Đã xác nhận
        </Button>
        <Button aria-pressed={filter === 'candidate'} onClick={() => setFilter('candidate')}>
          Ứng viên
        </Button>
      </div>
      <label className={styles.lowConfidence}>
        <input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Ẩn độ tin cậy thấp
      </label>
      {visible.filter((i) => handled(i) === done).length === 0 && (
        <p>{issues.length ? 'Đã xem hết gợi ý' : 'Chưa có gợi ý'}</p>
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
            const original = i.spans.map((s) => index.sliceCp(s.start, s.end)).join(' / ');
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
                <button
                  data-card
                  className={styles.cardButton}
                  onMouseEnter={() => setHovered(i.id)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(i.id)}
                  onBlur={() => setHovered(null)}
                  onClick={() => select(i.id, 'mark')}
                >
                  <span className={styles.cardCategory}>
                    <span className={styles.dot} aria-hidden="true" /> {categories[i.category]}
                  </span>
                  <span className={styles.cardSummary}>
                    <strong>{original}</strong> ·{' '}
                    <span>
                      {labels[i.type] ?? i.type} {i.severity === 'info' && 'AI: chấp nhận được'}
                    </span>
                  </span>
                </button>
                {selected === i.id && (
                  <div>
                    <strong>{labels[i.type] ?? i.type}</strong>
                    <p>
                      {i.status === 'dismissed_by_human' ? (
                        <CircleSlash size={14} />
                      ) : i.status === 'candidate' ? (
                        <Circle size={14} />
                      ) : (
                        <CheckCircle2 size={14} />
                      )}{' '}
                      {i.severity === 'info' && !handled(i) ? 'AI: chấp nhận được' : statuses[i.status]}
                    </p>
                    <p>{i.why}</p>
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
                    <p title={i.metric.name}>
                      {i.type === 'SUBJECT_VERB_GAP'
                        ? `Khoảng cách chủ–vị: ${i.metric.value} token (ngưỡng thử nghiệm ≥ ${SV_GAP_REVIEW})`
                        : i.type === 'CLAUSE_DEPTH'
                          ? `Độ sâu mệnh đề: ${i.metric.value} (ngưỡng ≥ ${CLAUSE_DEPTH_REVIEW})`
                          : `${i.metric.value ?? '—'} ${i.metric.unit === 'candidate' ? 'ứng viên' : i.metric.unit === 'tokens' ? 'token' : (i.metric.unit ?? '')}`}{' '}
                      · {severities[i.severity]} · {Math.round(i.confidence * 100)}% · {i.sourcePrinciple}
                    </p>
                    <label>
                      Mức độ{' '}
                      <select
                        value={i.severity}
                        onChange={(e) => onChange(i, { severity: e.target.value as Issue['severity'] })}
                      >
                        <option value="minor">Nhỏ</option>
                        <option value="moderate">Vừa</option>
                        <option value="major">Lớn</option>
                        {(i.severity === 'info' || i.severity === 'critical') && (
                          <option value={i.severity}>{severities[i.severity]}</option>
                        )}
                      </select>
                    </label>
                    <div className={styles.controls}>
                      {done ? (
                        <Button onClick={() => onChange(i, { status: 'candidate' })}>Hoàn tác</Button>
                      ) : (
                        <>
                          <Button
                            className={styles.primary}
                            onClick={() => onChange(i, { status: 'confirmed_by_human' })}
                          >
                            Xác nhận
                          </Button>
                          <Button
                            className={styles.textButton}
                            onClick={() => onChange(i, { status: 'dismissed_by_human' })}
                          >
                            Bỏ qua
                          </Button>
                        </>
                      )}
                      {suggestion && (
                        <Tooltip label="Sao chép gợi ý">
                          <IconButton
                            aria-label="Sao chép gợi ý"
                            onClick={() => {
                              void navigator.clipboard?.writeText(suggestion).catch(() => {});
                            }}
                          >
                            <Copy size={16} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </div>
                    <small>Áp dụng sửa đổi sẽ có ở module Chỉnh sửa</small>
                  </div>
                )}
              </li>
            );
          })}
      </ul>
      <small>Đây là ứng viên cần xem xét, không phải lỗi đã khẳng định.</small>
    </Card>
  );
  return (
    <div className={styles.workspace}>
      <div className={styles.reading}>
        {boundaries.slice(0, -1).map((start, n) => {
          const end = boundaries[n + 1] ?? start;
          const covering = visible.filter(
            (i) => i.status !== 'dismissed_by_human' && i.spans.some((s) => s.start <= start && s.end >= end),
          );
          const value = index.sliceCp(start, end);
          if (!covering.length) return <span key={start}>{value}</span>;
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
                aria-label={`${labels[issue.type] ?? issue.type}, ${severities[issue.severity]}, ${statuses[issue.status]}`}
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
                <button
                  type="button"
                  className={styles.overlapBadge}
                  onClick={activate}
                  aria-label={`Thêm ${covering.length - 2} gợi ý chồng lấp`}
                >
                  +{covering.length - 2}
                </button>
              )}
            </Fragment>
          );
        })}
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
          <Drawer open={drawerOpen} onClose={closeDrawer} label="Gợi ý" side="right">
            {panel}
          </Drawer>
        </>
      ) : (
        <div className={styles.panel}>{panel}</div>
      )}
    </div>
  );
}
