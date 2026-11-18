import { useEffect, useMemo, useState } from 'react';
import { publishedIdFor } from '@/core/paperModel/published';
import { projectScgPaper, type ScgPaperPublish } from '@/core/scg/publish';
import type { Paper, ScgPaperRun } from '@/core/schemas';
import { useAuth } from '@/shared/auth/authContext';
import {
  PublishScgError,
  publishScg,
  scgPublishState,
  type ScgPublishState,
} from '@/shared/pdfStore/scgPublished';
import { Button } from '@/shared/ui/Button';
import styles from './scg.module.css';

const STATE_TEXT: Record<ScgPublishState | 'unknown', string> = {
  no_model: 'Cần công bố paper model của bài (mục Thông tin bài) trước khi công bố đồ thị đóng góp.',
  none: 'Đồ thị đóng góp chưa được công bố.',
  current: 'Đã công bố, khớp với bản hiện tại.',
  outdated: 'Bản đã công bố đã cũ so với kết quả duyệt hiện tại.',
  unknown: 'Không kiểm tra được bản đã công bố.',
};

/** Publishes a finished run, without rejected items, so Writing Bank and SRD can read it from the worker. */
export function PublishScg({ paper, run, busy }: { paper: Paper; run: ScgPaperRun; busy: boolean }) {
  const { user, getIdToken } = useAuth();
  const uid = user?.uid;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const complete = run.status === 'complete';
  const graph = useMemo(() => {
    try {
      return projectScgPaper(run, publishedIdFor(paper.source.sha256, paper.id));
    } catch {
      return null;
    }
  }, [paper.id, paper.source.sha256, run]);
  // The state belongs to the graph it was checked for; a review change makes it unknown until checked again.
  const [checked, setChecked] = useState<{ graph: ScgPaperPublish; state: ScgPublishState | 'unknown' }>();
  const state = checked && checked.graph === graph ? checked.state : undefined;
  const setState = (next: ScgPublishState | 'unknown') => graph && setChecked({ graph, state: next });

  useEffect(() => {
    if (!uid || !complete || !graph) return;
    let live = true;
    void (async () => {
      try {
        const token = await getIdToken();
        if (!token) throw new PublishScgError(401);
        const next = await scgPublishState(graph, token);
        if (live) setChecked({ graph, state: next });
      } catch {
        if (live) setChecked({ graph, state: 'unknown' });
      }
    })();
    return () => {
      live = false;
    };
  }, [uid, complete, graph, getIdToken]);

  async function publish() {
    if (!graph) return;
    setSending(true);
    setError('');
    try {
      const token = await getIdToken();
      if (!token) throw new PublishScgError(401);
      await publishScg(graph, token);
      setState('current');
    } catch (cause) {
      if (cause instanceof PublishScgError && cause.status === 404) setState('no_model');
      setError(cause instanceof PublishScgError ? cause.message : 'Không công bố được đồ thị đóng góp.');
    } finally {
      setSending(false);
    }
  }

  const note = !user
    ? 'Đăng nhập tài khoản lab để công bố đồ thị đóng góp.'
    : !complete
      ? 'Chạy xong ba giai đoạn rồi mới công bố được.'
      : !graph
        ? 'Không tạo được bản công bố từ kết quả này.'
        : state && STATE_TEXT[state];
  return (
    <div className={styles.toolbar}>
      <Button
        disabled={
          !user ||
          !complete ||
          !graph ||
          busy ||
          sending ||
          !state ||
          state === 'no_model' ||
          state === 'current'
        }
        onClick={() => void publish()}
      >
        {sending ? 'Đang công bố…' : 'Công bố đồ thị đóng góp'}
      </Button>
      {note && (
        <span className={styles.muted} role="status">
          {note}
        </span>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
