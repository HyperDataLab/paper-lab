import { useState } from 'react';
import type { PaperModel } from '@/core/schemas';
import { useAuth } from '@/shared/auth/authContext';
import { publishPaperModel, PublishPaperError } from '@/shared/pdfStore/published';
import { Button } from '@/shared/ui/Button';
import styles from './snapshot.module.css';

export function PublishPaperModel({
  paperId,
  buildModel,
}: {
  paperId: string;
  buildModel: () => Promise<PaperModel>;
}) {
  const { user, getIdToken } = useAuth();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState('');

  async function publish() {
    if (!user || running) return;
    setRunning(true);
    setMessage('');
    setDetail('');
    try {
      const token = await getIdToken();
      if (!token) throw new PublishPaperError(401);
      const result = await publishPaperModel(await buildModel(), paperId, token);
      setMessage(
        result.unchanged
          ? 'Không có thay đổi so với bản đã công bố.'
          : `Đã công bố (mã ${result.etag.slice(0, 8)}) lúc ${new Date(result.updatedAt).toLocaleString('vi-VN')}.`,
      );
    } catch (error) {
      setMessage(
        error instanceof PublishPaperError
          ? error.message
          : 'Không công bố được paper model. Vui lòng thử lại.',
      );
      setDetail(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <Button disabled={!user || running} onClick={() => void publish()}>
        {running ? 'Đang công bố…' : 'Công bố lên máy chủ lab'}
      </Button>
      {!user && <p className={styles.note}>Đăng nhập tài khoản lab để công bố paper model.</p>}
      {message && <p role={detail ? 'alert' : 'status'}>{message}</p>}
      {detail && (
        <details>
          <summary>Chi tiết kỹ thuật</summary>
          <p>{detail}</p>
        </details>
      )}
    </>
  );
}
