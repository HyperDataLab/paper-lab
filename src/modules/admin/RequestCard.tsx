import { Link } from 'react-router-dom';
import { useState } from 'react';
import type { Paper } from '@/core/schemas';
import { useAuth } from '@/shared/auth/authContext';
import { decideFactRequest, FactRequestError, type FactRequest } from '@/shared/pdfStore/factRequests';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { TextField } from '@/shared/ui/TextField';
import { STATE_LABELS, STATE_TONES } from './stateLabels';
import styles from './admin.module.css';

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('vi-VN') : 'không rõ lúc nào';

/** One request for a paper's experiment facts, with the admin's decision or what to do after approving. */
export function RequestCard({
  request,
  localPaper,
  onDecided,
  onConflict,
}: {
  request: FactRequest;
  localPaper: Paper | undefined;
  onDecided: (updated: FactRequest) => void;
  onConflict: () => void;
}) {
  const { getIdToken } = useAuth();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function decide(decision: 'approve' | 'decline') {
    setSending(true);
    setError('');
    try {
      const token = await getIdToken();
      if (!token) throw new FactRequestError(401);
      onDecided(
        await decideFactRequest(
          token,
          request.paperId,
          decision,
          decision === 'decline' ? reason : undefined,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      if (caught instanceof FactRequestError && caught.status === 409) onConflict();
    } finally {
      setSending(false);
    }
  }

  const title = request.title || 'Bài chưa có title';
  return (
    <Card padding="md">
      <div className={styles.head}>
        <div>
          <strong className={styles.title}>{title}</strong>
          <p className={styles.meta}>
            {request.doi ? `DOI ${request.doi} · ` : ''}Yêu cầu bởi {request.requestedBy || 'không rõ'},{' '}
            {when(request.requestedAt)}
          </p>
        </div>
        <Badge tone={STATE_TONES[request.state]}>{STATE_LABELS[request.state]}</Badge>
      </div>
      {request.note && <p className={styles.note}>{request.note}</p>}
      {(request.state === 'approved' || request.state === 'declined' || request.state === 'done') &&
        request.decidedBy && (
          <p className={styles.meta}>
            {request.state === 'declined' ? 'Từ chối' : 'Duyệt'} bởi {request.decidedBy},{' '}
            {when(request.decidedAt)}
            {request.decisionNote ? `. Lý do: ${request.decisionNote}` : ''}
          </p>
        )}

      {request.state === 'requested' &&
        (declining ? (
          <div className={styles.decline}>
            <TextField
              multiline
              label="Lý do từ chối"
              hint="Người gửi yêu cầu sẽ đọc lý do này."
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className={styles.actions}>
              <Button disabled={sending || !reason.trim()} onClick={() => void decide('decline')}>
                {sending ? 'Đang gửi…' : 'Gửi từ chối'}
              </Button>
              <Button variant="ghost" disabled={sending} onClick={() => setDeclining(false)}>
                Huỷ
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.actions}>
            <Button disabled={sending} onClick={() => void decide('approve')}>
              {sending ? 'Đang gửi…' : 'Duyệt'}
            </Button>
            <Button variant="ghost" disabled={sending} onClick={() => setDeclining(true)}>
              Từ chối
            </Button>
          </div>
        ))}

      {request.state === 'approved' && (
        <div className={styles.next}>
          {localPaper ? (
            <>
              <p>Bài có trong thư viện này. Việc tiếp theo:</p>
              <ol>
                <li>
                  <Link to={`/papers/${encodeURIComponent(localPaper.id)}?view=measure`}>
                    Mở measurement của bài
                  </Link>{' '}
                  và chạy, rồi xem lại dữ kiện.
                </li>
                <li>
                  Ở{' '}
                  <Link to={`/papers/${encodeURIComponent(localPaper.id)}?view=metadata`}>
                    Publication info
                  </Link>
                  , bấm “Công bố lên máy chủ lab”. Yêu cầu chuyển sang Đã xong khi dữ kiện đã lên máy chủ.
                </li>
              </ol>
            </>
          ) : (
            <p>
              Bài này không có trong thư viện PaperLab trên máy này. Nhập đúng file PDF đã công bố rồi quay
              lại trang này.
            </p>
          )}
        </div>
      )}

      {error && <p role="alert">{error}</p>}
      <details>
        <summary>Chi tiết kỹ thuật</summary>
        <p>Mã bài trên máy chủ: {request.paperId}</p>
      </details>
    </Card>
  );
}
