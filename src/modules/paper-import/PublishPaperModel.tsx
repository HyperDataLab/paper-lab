import { useState } from 'react';
import { projectExperimentFacts } from '@/core/experimentFacts/project';
import { contentEtag, publishedPaperId } from '@/core/paperModel/published';
import type { PaperModel } from '@/core/schemas';
import { useAuth } from '@/shared/auth/authContext';
import { publishExperimentFacts, publishPaperModel, PublishPaperError } from '@/shared/pdfStore/published';
import { useHubProjectId, useRepositories } from '@/shared/storage/StorageProvider';
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
  const projectId = useHubProjectId();
  const repo = useRepositories();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState('');

  async function publish() {
    if (!user || !projectId || running) return;
    setRunning(true);
    setMessage('');
    setDetail('');
    try {
      const token = await getIdToken();
      if (!token) throw new PublishPaperError(401);
      const model = await buildModel();
      const result = await publishPaperModel(model, paperId, token, projectId);
      const modelMessage = result.unchanged
        ? 'Không có thay đổi so với bản đã công bố'
        : `Đã công bố (mã ${result.etag.slice(0, 8)}) lúc ${new Date(result.updatedAt).toLocaleString('vi-VN')}`;
      setMessage(`${modelMessage}.`);
      try {
        const record = await repo.measurements.get(paperId);
        if (!record?.runs.length) {
          setMessage(`${modelMessage}, chưa có dữ kiện thí nghiệm.`);
        } else {
          const paper = await repo.papers.get(paperId);
          if (!paper) throw new Error('Không tìm thấy bài báo trong dữ liệu cục bộ.');
          const { facts } = projectExperimentFacts({
            paperId: publishedPaperId(model, paperId),
            modelEtag: await contentEtag(model),
            model,
            record,
            paper,
            now: new Date(),
          });
          await publishExperimentFacts(facts, token, projectId);
          setMessage(
            `${modelMessage}, kèm ${facts.facts.length} dữ kiện thí nghiệm (${facts.facts.filter((fact) => fact.status === 'accepted').length} đã duyệt).`,
          );
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        setMessage(`${modelMessage}. Không công bố được dữ kiện thí nghiệm: ${reason}`);
        setDetail(reason);
      }
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
      <Button disabled={!user || !projectId || running} onClick={() => void publish()}>
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
