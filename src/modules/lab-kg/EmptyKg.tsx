import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KG_INGEST_LIMIT, type KgIngestResult } from '@/core/schemas/labKg';
import { useAuth } from '@/shared/auth/authContext';
import { asLabKgError, enqueueLabKg, labKgIds, type LabKgError } from '@/shared/labKg/client';
import { useHubProjectId, useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Empty } from '@/shared/ui/StateNote';
import { ErrorNote } from './ErrorNote';
import styles from './labKg.module.css';

interface CorpusChoice {
  id: string;
  title: string;
  members: number;
  ids: string[];
}

type Progress = { corpusId: string; total: number; sent: number; result?: KgIngestResult; done: boolean };

/** The KG holds no paper yet: say how it fills, and send a local corpus to the ingest queue. */
export function EmptyKg({ queue, onQueued }: { queue: number; onQueued: () => void }) {
  const { getIdToken } = useAuth();
  const projectId = useHubProjectId();
  const repo = useRepositories();
  const [corpora, setCorpora] = useState<CorpusChoice[]>();
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState<LabKgError>();

  useEffect(() => {
    let live = true;
    void repo.corpora
      .list()
      .then((list) => {
        if (live)
          setCorpora(
            list.map((corpus) => ({
              id: corpus.id,
              title: corpus.title,
              members: corpus.members.length,
              ids: labKgIds(corpus.members.map(({ identifiers }) => identifiers)),
            })),
          );
      })
      .catch(() => live && setCorpora([]));
    return () => {
      live = false;
    };
  }, [repo]);

  async function send(corpus: CorpusChoice) {
    setError(undefined);
    setProgress({ corpusId: corpus.id, total: corpus.ids.length, sent: 0, done: false });
    try {
      const token = await getIdToken();
      if (!projectId) throw new Error('Mở một project ResearchHub để thêm vào KG.');
      const result = await enqueueLabKg(corpus.ids, token, projectId, 'seed', (partial, sent) =>
        setProgress({ corpusId: corpus.id, total: corpus.ids.length, sent, result: partial, done: false }),
      );
      setProgress({
        corpusId: corpus.id,
        total: corpus.ids.length,
        sent: corpus.ids.length,
        result,
        done: true,
      });
      onQueued();
    } catch (cause) {
      setError(asLabKgError(cause, 'Không đưa được corpus vào KG của lab.'));
      setProgress((previous) => previous && { ...previous, done: true });
    }
  }

  const busy = progress !== undefined && !progress.done;
  return (
    <section className={styles.emptyKg} aria-labelledby="lab-kg-empty">
      <Empty
        title="KG của lab chưa có bài nào"
        hint={`Các bài được lấy từ OpenAlex trong nền, vài phút một lượt.${queue ? ` Đang có ${queue} bài chờ xử lý.` : ''}`}
      />
      <ol className={styles.steps}>
        <li>Chọn một corpus bên dưới, hoặc gõ DOI của một bài vào ô tìm rồi bấm “Đưa bài này vào KG”.</li>
        <li>Máy chủ lab lấy từng bài cùng references và các bài dẫn nó từ OpenAlex.</li>
        <li>Số liệu ở trên tự cập nhật; khi KG có bài, chọn một điểm bắt đầu để xem đồ thị.</li>
      </ol>
      <h2 id="lab-kg-empty" className={styles.heading}>
        Chọn corpus để đưa vào KG
      </h2>
      {!corpora ? (
        <p className={styles.muted}>Đang tải corpus…</p>
      ) : !corpora.length ? (
        <p className={styles.muted}>
          Chưa có corpus nào trong trình duyệt này. <Link to="/corpus">Mở Corpus</Link>
        </p>
      ) : (
        <ul className={styles.corpora} aria-label="Corpus trong trình duyệt này">
          {corpora.map((corpus) => {
            const mine = progress?.corpusId === corpus.id ? progress : undefined;
            return (
              <li key={corpus.id}>
                <span>
                  <strong>{corpus.title}</strong>{' '}
                  <small className={styles.muted}>
                    {corpus.members} bài · {corpus.ids.length} có DOI hoặc OpenAlex ID
                  </small>
                </span>
                <Button size="sm" disabled={busy || !corpus.ids.length} onClick={() => void send(corpus)}>
                  {mine && !mine.done ? 'Đang gửi…' : `Đưa ${corpus.ids.length} bài vào KG`}
                </Button>
                {mine && (
                  <small role="status" className={styles.progress}>
                    Đã gửi {mine.sent}/{mine.total}
                    {mine.total > KG_INGEST_LIMIT ? ` (${KG_INGEST_LIMIT} bài một lượt)` : ''}
                    {mine.result &&
                      ` · Đã xếp ${mine.result.queued} · Xử lý ngay ${mine.result.processed} · Bỏ qua ${mine.result.skipped} · Lỗi ${mine.result.errors.length}`}
                  </small>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <ErrorNote error={error} />}
    </section>
  );
}
