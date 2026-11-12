import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ExtractionCell, ProjectField, ProjectPaper } from '@/core/schemas';
import type { ReviewAction } from '@/core/extraction';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Drawer } from '@/shared/ui/Drawer';
import { TextField } from '@/shared/ui/TextField';
import { ACCESS, FLAGS, STATUS, VERDICTS } from './labels';
import { SheetSection } from '@/shared/ui/SheetSection';
import styles from './sheets.module.css';

const ACTIONS: Record<string, string> = {
  extract: 'AI trích',
  verify: 'AI kiểm chứng',
  approve: 'Xác nhận',
  edit: 'Sửa',
  reject: 'Bác bỏ',
  reopen: 'Mở lại',
};

/** One cell beside the matrix: the value, where it came from, why it has its status, and its history. */
export function CellDrawer({
  cell,
  field,
  paper,
  stale,
  onClose,
  onReview,
  onRerun,
}: {
  cell: ExtractionCell;
  field: ProjectField;
  paper: ProjectPaper;
  stale: boolean;
  onClose: () => void;
  onReview: (action: ReviewAction, value?: string) => void;
  onRerun: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cell.value ?? cell.aiValue ?? '');
  const decided = cell.status === 'VERIFIED' || cell.flags.includes('REJECTED_BY_REVIEWER');
  return (
    <Drawer
      open
      onClose={onClose}
      label="Chi tiết ô"
      side="right"
      title={field.label}
      description={paper.title}
      footer={
        editing ? (
          <>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Huỷ
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onReview('edit', draft);
                setEditing(false);
              }}
            >
              Lưu và xác nhận
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" className={styles.footStart} onClick={onRerun}>
              <RotateCcw size={16} aria-hidden="true" />
              Chạy lại ô này
            </Button>
            {decided ? (
              <Button onClick={() => onReview('reopen')}>Hoàn tác</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => onReview('reject')}>
                  Bác bỏ
                </Button>
                <Button onClick={() => setEditing(true)}>Sửa</Button>
                <Button
                  variant="primary"
                  disabled={!cell.value && !cell.aiValue}
                  onClick={() => onReview('approve')}
                >
                  Xác nhận
                </Button>
              </>
            )}
          </>
        )
      }
    >
      <div className={styles.badges}>
        <Badge tone={STATUS[cell.status].tone}>{STATUS[cell.status].label}</Badge>
        <Badge>{ACCESS[cell.sourceAccess]}</Badge>
        {cell.assertion === 'INFERRED' && <Badge tone="warning">AI suy ra</Badge>}
        {cell.verdict && (
          <Badge tone={cell.verdict === 'SUPPORTED' ? 'success' : 'warning'}>
            Kiểm chứng tự động: {VERDICTS[cell.verdict]}
          </Badge>
        )}
        {stale && <Badge tone="warning">Đã cũ, nên chạy lại</Badge>}
      </div>
      <SheetSection title="Giá trị">
        {editing ? (
          <TextField
            label="Giá trị sau khi sửa"
            multiline
            rows={4}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : (
          <p className={styles.value}>
            {cell.value ?? <span className={styles.missing}>Chưa có giá trị kiểm chứng được</span>}
          </p>
        )}
        {cell.aiValue && cell.aiValue !== cell.value && (
          <p className={styles.hint}>AI trả về: “{cell.aiValue}”</p>
        )}
      </SheetSection>
      <SheetSection title={`Bằng chứng (${cell.evidence.length})`}>
        {cell.evidence.length === 0 ? (
          <p className={styles.missing}>Không có trích dẫn tìm thấy trong bài.</p>
        ) : (
          <ul className={styles.quotes}>
            {cell.evidence.map((item) => (
              <li
                key={`${item.paragraphId}:${item.start}`}
                data-conflict={item.stance === 'conflicts' || undefined}
              >
                {item.stance === 'conflicts' && <Badge tone="danger">Đoạn nói khác</Badge>}
                <blockquote>{item.quote}</blockquote>
                <span className={styles.where}>
                  {[item.page ? `Tr. ${item.page}` : null, item.section].filter(Boolean).join(' · ') ||
                    'Tóm tắt'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {paper.source.kind === 'paper' && (
          <Link className={styles.link} to={`/papers/${paper.source.paperId}`}>
            Mở bài báo
          </Link>
        )}
      </SheetSection>
      {cell.verifierNote && (
        <SheetSection title="Ghi chú kiểm chứng">
          <p className={styles.hint}>{cell.verifierNote}</p>
        </SheetSection>
      )}
      {cell.flags.length > 0 && (
        <SheetSection title="Lưu ý">
          <ul className={styles.flags}>
            {cell.flags.map((flag) => (
              <li key={flag}>{FLAGS[flag] ?? flag}</li>
            ))}
          </ul>
        </SheetSection>
      )}
      <SheetSection title={`Lịch sử (${cell.history.length})`}>
        <ol className={styles.timeline}>
          {[...cell.history].reverse().map((entry, index) => (
            <li key={index}>
              <strong>{ACTIONS[entry.action]}</strong>
              <span>
                {entry.by === 'human' ? 'Người duyệt' : 'Mô hình'} · {STATUS[entry.status].label}
              </span>
              <time>{new Date(entry.at).toLocaleString('vi-VN')}</time>
            </li>
          ))}
        </ol>
      </SheetSection>
    </Drawer>
  );
}
