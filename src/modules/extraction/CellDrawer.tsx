import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ExtractionCell, ProjectField, ProjectPaper } from '@/core/schemas';
import type { ReviewAction } from '@/core/extraction';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Drawer } from '@/shared/ui/Drawer';
import { TextField } from '@/shared/ui/TextField';
import { ACCESS, FLAGS, STATUS, VERDICTS } from './labels';
import styles from './extraction.module.css';

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
  return (
    <Drawer open onClose={onClose} label="Chi tiết ô" side="right">
      <div className={styles.drawer}>
        <header className={styles.drawerHead}>
          <div>
            <h2>{field.label}</h2>
            <p className={styles.note}>{paper.title}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Đóng
          </Button>
        </header>
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
        <section>
          <h3>Giá trị</h3>
          {editing ? (
            <>
              <TextField
                label="Giá trị sau khi sửa"
                multiline
                rows={4}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className={styles.actions}>
                <Button
                  variant="primary"
                  onClick={() => {
                    onReview('edit', draft);
                    setEditing(false);
                  }}
                >
                  Lưu và xác nhận
                </Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Huỷ
                </Button>
              </div>
            </>
          ) : (
            <p className={styles.value}>
              {cell.value ?? <span className={styles.missing}>Chưa có giá trị kiểm chứng được</span>}
            </p>
          )}
          {cell.aiValue && cell.aiValue !== cell.value && (
            <p className={styles.note}>AI trả về: “{cell.aiValue}”</p>
          )}
        </section>
        <section>
          <h3>Bằng chứng</h3>
          {cell.evidence.length === 0 ? (
            <p className={styles.missing}>Không có trích dẫn tìm thấy trong bài.</p>
          ) : (
            <ul className={styles.evidence}>
              {cell.evidence.map((item) => (
                <li key={`${item.paragraphId}:${item.start}`}>
                  {item.stance === 'conflicts' && <Badge tone="danger">Đoạn nói khác</Badge>}
                  <blockquote>{item.quote}</blockquote>
                  <span className={styles.note}>
                    {[item.page ? `Tr. ${item.page}` : null, item.section].filter(Boolean).join(' · ') ||
                      'Tóm tắt'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {paper.source.kind === 'paper' && <Link to={`/papers/${paper.source.paperId}`}>Mở bài báo</Link>}
        </section>
        {cell.verifierNote && <p className={styles.note}>Ghi chú kiểm chứng: {cell.verifierNote}</p>}
        {cell.flags.length > 0 && (
          <section>
            <h3>Lưu ý</h3>
            <ul className={styles.flags}>
              {cell.flags.map((flag) => (
                <li key={flag}>{FLAGS[flag] ?? flag}</li>
              ))}
            </ul>
          </section>
        )}
        <div className={styles.actions}>
          {cell.status === 'VERIFIED' || cell.flags.includes('REJECTED_BY_REVIEWER') ? (
            <Button variant="ghost" onClick={() => onReview('reopen')}>
              Hoàn tác
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                disabled={!cell.value && !cell.aiValue}
                onClick={() => onReview('approve')}
              >
                Xác nhận
              </Button>
              <Button onClick={() => setEditing(true)}>Sửa</Button>
              <Button variant="ghost" onClick={() => onReview('reject')}>
                Bác bỏ
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={onRerun}>
            Chạy lại ô này
          </Button>
        </div>
        <details>
          <summary>Lịch sử ({cell.history.length})</summary>
          <ol className={styles.history}>
            {cell.history.map((entry, index) => (
              <li key={index}>
                {new Date(entry.at).toLocaleString('vi-VN')} · {ACTIONS[entry.action]} ·{' '}
                {entry.by === 'human' ? 'người duyệt' : 'mô hình'} · {STATUS[entry.status].label}
              </li>
            ))}
          </ol>
        </details>
      </div>
    </Drawer>
  );
}
