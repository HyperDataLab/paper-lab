import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Paper } from '@/core/schemas';
import { PaperSizeError } from '@/shared/paper/sizeGuard';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Dialog } from '@/shared/ui/Dialog';
import { Tabs } from '@/shared/ui/Tabs';
import { importPaperFile } from './importPaperFile';
import { LibraryPanel } from './LibraryPanel';
import styles from './page.module.css';

export default function Page() {
  const repo = useRepositories();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [detail, setDetail] = useState('');
  const [deleting, setDeleting] = useState<Paper | null>(null);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [view, setView] = useState<'papers' | 'library'>('papers');
  const load = useCallback(() => {
    void repo.papers
      .list()
      .then(setPapers)
      .catch((cause: unknown) => {
        setError('Không thể tải danh sách bài báo.');
        setDetail(String(cause));
      });
  }, [repo]);
  useEffect(() => {
    load();
  }, [load]);
  async function read(file: File) {
    if (busy) return;
    setBusy(true);
    setError('');
    setDetail('');
    setProgress('');
    try {
      const paper = await importPaperFile(file, repo, { onProgress: setProgress });
      navigate(`/papers/${paper.id}`);
    } catch (cause) {
      setError(
        cause instanceof PaperSizeError ? cause.message : 'Không thể nhập bài báo. Vui lòng kiểm tra tệp.',
      );
      setDetail(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  async function remove() {
    if (!deleting) return;
    try {
      await repo.papers.delete(deleting.id);
      setDeleting(null);
      load();
    } catch (cause) {
      setError('Không thể xoá bài báo.');
      setDetail(String(cause));
    }
  }
  return (
    <div className={styles.page}>
      <h1>Bài báo</h1>
      <Tabs label="Bài báo">
        <Button role="tab" aria-selected={view === 'papers'} onClick={() => setView('papers')}>
          Bài đã nhập
        </Button>
        <Button role="tab" aria-selected={view === 'library'} onClick={() => setView('library')}>
          Thư viện DOI
        </Button>
      </Tabs>
      {view === 'library' && <LibraryPanel />}
      {view === 'papers' && (
        <>
          <Card>
            <div
              className={styles.drop}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file) void read(file);
              }}
            >
              <p>Kéo thả tệp PDF, LaTeX, Markdown hoặc văn bản vào đây.</p>
              <input
                ref={input}
                className={styles.hidden}
                aria-label="Chọn tệp bài báo"
                type="file"
                accept=".pdf,.tex,.md,.txt,application/pdf,text/plain,text/markdown"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void read(file);
                }}
              />
              <Button variant="primary" disabled={busy} onClick={() => input.current?.click()}>
                Chọn tệp
              </Button>
              <p>Tệp được xử lý trên máy của bạn, không tải lên máy chủ</p>
              {busy && <p role="status">{progress || 'Đang xử lý tệp…'}</p>}
            </div>
            {error && (
              <div role="alert">
                {error}
                {detail && (
                  <details>
                    <summary>Chi tiết kỹ thuật</summary>
                    {detail}
                  </details>
                )}
              </div>
            )}
          </Card>
          <h2>Bài báo đã nhập</h2>
          {!papers.length ? (
            <p>Chưa có bài báo.</p>
          ) : (
            <ul className={styles.list}>
              {papers.map((paper) => (
                <li key={paper.id}>
                  <Card>
                    <div className={styles.row}>
                      <div>
                        <Link className={styles.paperTitle} to={`/papers/${paper.id}`}>
                          {paper.title}
                        </Link>
                        <p className={styles.paperMeta}>
                          {paper.source.pageCount ?? 'Không rõ'} trang · {paper.sections.length} mục ·{' '}
                          {paper.paragraphs.length} đoạn ·{' '}
                          {new Date(paper.createdAt).toLocaleDateString('vi')}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          setTrigger(event.currentTarget);
                          setDeleting(paper);
                        }}
                      >
                        Xoá
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {deleting && (
        <Dialog
          title="Xoá bài báo này?"
          description={`Bài báo ${deleting.title} sẽ bị xoá. Nhật ký vẫn được giữ lại.`}
          returnFocus={trigger}
          onClose={() => setDeleting(null)}
        >
          <div className={styles.row}>
            <Button data-dialog-initial-focus onClick={() => setDeleting(null)}>
              Huỷ
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Xoá bài báo
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
