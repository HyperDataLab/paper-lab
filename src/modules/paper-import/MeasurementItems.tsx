import { useState } from 'react';
import type { AtomicSentence, Evidence, MeasurementDecision, ProfileField } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/TextField';
import styles from './measurement.module.css';

export type Location = { paragraphId: string; start: number; end: number };
export type Decide = (input: {
  item_id: string;
  field: string | null;
  decision: MeasurementDecision['decision'];
  previous_value: string | null;
  new_value: string | null;
}) => void;
export interface ItemContext {
  evidence: Map<string, Evidence>;
  decisions: Map<string, MeasurementDecision>;
  onLocation: (location: Location) => void;
  decide: Decide;
  atomics?: Map<string, AtomicSentence>;
  openAtomic?: (id: string) => void;
}

export function AtomicLinks({ ids, context }: { ids: string[] | undefined; context: ItemContext }) {
  return (
    <>
      {(ids ?? []).flatMap((id) => {
        const atom = context.atomics?.get(id);
        if (!atom) return [];
        return [
          <Button
            key={id}
            size="sm"
            variant="ghost"
            title={atom.text}
            onClick={() => context.openAtomic?.(id)}
          >
            Câu nguyên tử {Number(id.replace('as-', ''))}
          </Button>,
        ];
      })}
    </>
  );
}

const STATUS: Record<ProfileField['status'], { label: string; tone: 'accent' | 'neutral' | 'warning' }> = {
  REPORTED: { label: 'Tác giả nêu', tone: 'accent' },
  HUMAN_EDITED: { label: 'Người duyệt sửa', tone: 'neutral' },
  INFERRED: { label: 'AI diễn giải', tone: 'neutral' },
  DERIVED: { label: 'AI tính từ số liệu', tone: 'neutral' },
  NOT_REPORTED: { label: 'Không thấy trong phần đã phân tích', tone: 'neutral' },
  NOT_APPLICABLE: { label: 'Không áp dụng', tone: 'neutral' },
  CONTRADICTORY: { label: 'Mâu thuẫn trong bài', tone: 'warning' },
  NOT_CHECKED: { label: 'Chưa kiểm tra', tone: 'warning' },
};

const KIND_LABELS: Record<Evidence['kind'], string> = {
  text: 'đoạn văn',
  table: 'bảng',
  figure: 'hình',
  equation: 'công thức',
};

export function StatusBadges({
  status,
  needsReview,
}: {
  status: ProfileField['status'];
  needsReview: boolean;
}) {
  const shown = STATUS[status];
  return (
    <>
      <Badge tone={shown.tone}>{shown.label}</Badge>
      {needsReview && <Badge tone="warning">Cần xem lại</Badge>}
    </>
  );
}

export function EvidenceLinks({ ids, context }: { ids: string[]; context: ItemContext }) {
  return (
    <>
      {ids.flatMap((id) => {
        const item = context.evidence.get(id);
        if (!item) return [];
        const place = item.cell
          ? `hàng ${item.cell.row + 1}, cột ${item.cell.column + 1}`
          : KIND_LABELS[item.kind];
        return [
          <Button
            key={id}
            size="sm"
            variant="ghost"
            title={item.source_excerpt}
            onClick={() =>
              context.onLocation({
                paragraphId: item.blockId,
                start: item.span?.start ?? 0,
                end: item.span?.end ?? 1,
              })
            }
          >
            {item.page ? `Tr. ${item.page}` : 'Không rõ trang'} · {place}
          </Button>,
        ];
      })}
    </>
  );
}

export function ItemActions({
  itemId,
  context,
  value = null,
  acceptLabel = 'Chấp nhận',
  acceptedLabel = 'Đã chấp nhận',
}: {
  itemId: string;
  context: ItemContext;
  value?: string | null;
  acceptLabel?: string;
  acceptedLabel?: string;
}) {
  const decision = context.decisions.get(`${itemId}|`);
  const send = (next: MeasurementDecision['decision']) =>
    context.decide({ item_id: itemId, field: null, decision: next, previous_value: value, new_value: null });
  if (decision?.decision === 'accept' || decision?.decision === 'reject')
    return (
      <span className={styles.actions}>
        <Badge tone={decision.decision === 'accept' ? 'success' : 'danger'}>
          {decision.decision === 'accept' ? acceptedLabel : 'Đã loại'}
        </Badge>
        <Button size="sm" variant="ghost" onClick={() => send('reopen')}>
          Hoàn tác
        </Button>
      </span>
    );
  return (
    <span className={styles.actions}>
      <Button size="sm" onClick={() => send('accept')}>
        {acceptLabel}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => send('reject')}>
        Loại bỏ
      </Button>
    </span>
  );
}

export function FieldRow({
  label,
  field,
  itemId,
  path,
  context,
}: {
  label: string;
  field: ProfileField;
  itemId: string;
  path: string;
  context: ItemContext;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.value ?? '');
  const edited = context.decisions.get(`${itemId}|${path}`)?.decision === 'edit';
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <div>
        {editing ? (
          <>
            <TextField
              multiline
              label={`Sửa: ${label}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button
              size="sm"
              onClick={() => {
                context.decide({
                  item_id: itemId,
                  field: path,
                  decision: 'edit',
                  previous_value: field.value,
                  new_value: draft.trim() || null,
                });
                setEditing(false);
              }}
            >
              Lưu
            </Button>{' '}
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Huỷ
            </Button>
          </>
        ) : (
          <p className={styles.value}>{field.value ?? '—'}</p>
        )}
        <div className={styles.meta}>
          <StatusBadges status={field.status} needsReview={field.needs_review} />
          {edited && <Badge tone="success">Đã sửa</Badge>}
          <EvidenceLinks ids={field.evidence_ids} context={context} />
          <AtomicLinks ids={field.atomic_ids} context={context} />
          {field.search_scope && (
            <span title={field.search_scope.join(', ')}>
              Đã tìm trong {field.search_scope.length} section
            </span>
          )}
          {!editing && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(field.value ?? '');
                setEditing(true);
              }}
            >
              Sửa
            </Button>
          )}
          {field.needs_review && !edited && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                context.decide({
                  item_id: itemId,
                  field: path,
                  decision: 'accept',
                  previous_value: field.value,
                  new_value: field.value,
                })
              }
            >
              Đánh dấu đã xem
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
