import { useState } from 'react';
import {
  bucketOf,
  normalThresholds,
  TRIAGE_BUCKETS,
  type Criterion,
  type Thresholds,
  type TriageBucket,
  type TriageSort,
} from '@/core/extraction';
import type { Candidate } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Chip } from '@/shared/ui/Chip';
import { Dialog, DialogActions } from '@/shared/ui/Dialog';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import styles from './extraction.module.css';
import { BUCKET_LABEL } from './labels';

/** `check` is the borderline sample a person should look at first. */
export type TriageFilter = 'all' | TriageBucket | 'check';

const score = (value: number | null | undefined) => (typeof value === 'number' ? value.toFixed(2) : '–');
const threshold = (text: string, fallback: number) => {
  const value = Number(text.replace(',', '.'));
  return text.trim() && Number.isFinite(value) ? value : fallback;
};

/**
 * Summary, thresholds, score filters and bulk apply for the AI triage. Every bulk apply goes through a
 * confirmation that names the count; `onApply` is called only after the person confirms.
 */
export function TriagePanel({
  buckets,
  borderline,
  thresholds,
  onThresholds,
  filter,
  onFilter,
  sort,
  onSort,
  disabled,
  onApply,
}: {
  buckets: Record<TriageBucket, Candidate[]>;
  borderline: string[];
  thresholds: Thresholds;
  onThresholds: (next: Thresholds) => void;
  filter: TriageFilter;
  onFilter: (next: TriageFilter) => void;
  sort: TriageSort;
  onSort: (next: TriageSort) => void;
  disabled: boolean;
  onApply: (bucket: TriageBucket, keys: string[]) => void;
}) {
  const [confirm, setConfirm] = useState<TriageBucket | null>(null);
  const [draft, setDraft] = useState({
    include: String(thresholds.include),
    exclude: String(thresholds.exclude),
  });
  const total = TRIAGE_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket].length, 0);
  const update = (next: typeof draft) => {
    setDraft(next);
    onThresholds(
      normalThresholds({
        include: threshold(next.include, thresholds.include),
        exclude: threshold(next.exclude, thresholds.exclude),
      }),
    );
  };
  const pending = confirm ? buckets[confirm] : [];
  if (!total) return null;
  return (
    <section aria-label="Đề xuất sàng lọc của AI">
      <p role="status">
        AI đề xuất:{' '}
        {TRIAGE_BUCKETS.map((bucket) => `${BUCKET_LABEL[bucket]} ${buckets[bucket].length}`).join(' · ')}
      </p>
      <p className={styles.note}>
        Chọn khi relevance ≥ ngưỡng chọn và không khớp tiêu chí loại; Loại khi relevance dưới ngưỡng loại hoặc
        khớp một tiêu chí loại; còn lại là Chưa chắc. Chỉ áp dụng khi bạn xác nhận.
      </p>
      <div className={styles.twoCols}>
        <TextField
          label="Ngưỡng chọn (relevance ≥)"
          type="number"
          inputMode="decimal"
          min={0}
          max={1}
          step={0.05}
          value={draft.include}
          onChange={(event) => update({ ...draft, include: event.target.value })}
        />
        <TextField
          label="Ngưỡng loại (relevance <)"
          type="number"
          inputMode="decimal"
          min={0}
          max={1}
          step={0.05}
          value={draft.exclude}
          onChange={(event) => update({ ...draft, exclude: event.target.value })}
        />
      </div>
      <div className={styles.chips}>
        <Chip aria-pressed={filter === 'all'} onClick={() => onFilter('all')}>
          Mọi đề xuất
        </Chip>
        {TRIAGE_BUCKETS.map((bucket) => (
          <Chip
            key={bucket}
            aria-pressed={filter === bucket}
            count={buckets[bucket].length}
            onClick={() => onFilter(bucket)}
          >
            AI: {BUCKET_LABEL[bucket]}
          </Chip>
        ))}
        <Chip
          aria-pressed={filter === 'check'}
          count={borderline.length}
          disabled={!borderline.length}
          onClick={() => onFilter('check')}
        >
          Kiểm tra ngẫu nhiên
        </Chip>
        <Select
          label="Sắp xếp"
          size="sm"
          inline
          value={sort}
          onChange={(event) => onSort(event.target.value as TriageSort)}
        >
          <option value="default">Thứ tự tìm thấy</option>
          <option value="relevance-desc">Relevance cao trước</option>
          <option value="relevance-asc">Relevance thấp trước</option>
          <option value="quality-desc">Quality cao trước</option>
        </Select>
      </div>
      {filter === 'check' && (
        <p className={styles.note}>
          Những bài gần ngưỡng nhất, hoặc mô hình tự đề xuất khác với ngưỡng. Xem các bài này trước khi áp
          dụng hàng loạt.
        </p>
      )}
      <div className={styles.actions}>
        {TRIAGE_BUCKETS.map((bucket) => (
          <Button
            key={bucket}
            disabled={disabled || !buckets[bucket].length}
            onClick={() => setConfirm(bucket)}
          >
            Áp dụng đề xuất cho {buckets[bucket].length} bài {BUCKET_LABEL[bucket]}
          </Button>
        ))}
      </div>
      {confirm && (
        <Dialog
          title={`Áp dụng ${BUCKET_LABEL[confirm]} cho ${pending.length} bài?`}
          description={`Ghi quyết định ${BUCKET_LABEL[confirm]} cho ${pending.length} bài theo ngưỡng hiện tại, ghi nhận là bạn chấp nhận đề xuất AI. Bạn vẫn đổi được từng bài sau.`}
          onClose={() => setConfirm(null)}
        >
          <ul className={styles.history}>
            {pending.slice(0, 8).map((item) => (
              <li key={item.key}>{item.title}</li>
            ))}
            {pending.length > 8 && <li>và {pending.length - 8} bài khác</li>}
          </ul>
          <DialogActions>
            <Button onClick={() => setConfirm(null)}>Huỷ</Button>
            <Button
              variant="primary"
              data-dialog-initial-focus
              onClick={() => {
                onApply(
                  confirm,
                  pending.map((item) => item.key),
                );
                setConfirm(null);
              }}
            >
              Xác nhận {pending.length} bài
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </section>
  );
}

/** Scores, reason and matched criteria on one paper's card, with the accept button for its bucket. */
export function TriageDetails({
  candidate,
  thresholds,
  criteria,
  flagged,
  disabled,
  onAccept,
}: {
  candidate: Candidate;
  thresholds: Thresholds;
  criteria: Criterion[];
  flagged: boolean;
  disabled: boolean;
  onAccept: (bucket: TriageBucket) => void;
}) {
  const suggestion = candidate.suggestion;
  const bucket = bucketOf(candidate, thresholds);
  if (!suggestion || !bucket) return null;
  const matched = (suggestion.matched ?? []).flatMap((id) => criteria.find((item) => item.id === id) ?? []);
  return (
    <>
      <span className={styles.note}>
        Relevance {score(suggestion.relevance)} · Quality {score(suggestion.quality)} · AI
        {suggestion.model ? ` ${suggestion.model}` : ''} · {suggestion.promptVersion}
        {suggestion.decision !== bucket && ` · mô hình đề xuất ${BUCKET_LABEL[suggestion.decision]}`}
      </span>
      {(flagged || matched.length > 0) && (
        <div className={styles.badges}>
          {flagged && <Badge tone="warning">Cần xem trước</Badge>}
          {matched.map((item) => (
            <Badge key={item.id} tone={item.kind === 'exclude' ? 'danger' : 'success'}>
              {item.kind === 'exclude' ? 'Khớp tiêu chí loại' : 'Đạt tiêu chí'} {item.id}: {item.text}
            </Badge>
          ))}
        </div>
      )}
      {candidate.status === 'candidate' && (
        <div className={styles.actions}>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onAccept(bucket)}>
            Nhận đề xuất: {BUCKET_LABEL[bucket]}
          </Button>
        </div>
      )}
    </>
  );
}
