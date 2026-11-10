import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authorsShort, paperIdentity, type PaperIdentity } from '@/core/paperIdentity';
import type { Paper } from '@/core/schemas';
import { PaperSizeError } from '@/shared/paper/sizeGuard';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Dialog } from '@/shared/ui/Dialog';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { Tabs } from '@/shared/ui/Tabs';
import { importPaperFile } from './importPaperFile';
import { LibraryPanel } from './LibraryPanel';
import styles from './page.module.css';

type Sort = 'recent' | 'title' | 'year';
const SOURCE_NOTE: Partial<Record<PaperIdentity['titleSource'], string>> = {
  detected: 'Tên dò từ trang đầu',
  file: 'Tên tệp · chưa có metadata',
};

export default function Page() {
  const repo = useRepositories();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [identities, setIdentities] = useState(new Map<string, PaperIdentity>());
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [detail, setDetail] = useState('');
  const [deleting, setDeleting] = useState<Paper | null>(null);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [view, setView] = useState<'papers' | 'library'>('papers');
  const load = useCallback(() => {
    void Promise.all([repo.papers.list(), repo.paperContext.list(), repo.library.list()])
      .then(([saved, contexts, library]) => {
        setPapers(saved);
        setIdentities(
          new Map(
            saved.map((paper) => [
              paper.id,
              paperIdentity(paper, {
                metadata: contexts.find((item) => item.paperId === paper.id)?.metadata,
                library: library.find((item) => item.paper_id === paper.id),
              }),
            ]),
          ),
        );
      })
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
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const listed = papers
      .map((paper) => ({
        paper,
        identity: identities.get(paper.id) ?? paperIdentity(paper),
      }))
      .filter(
        ({ paper, identity }) =>
          !needle ||
          [
            identity.title,
            paper.title,
            paper.source.fileName,
            identity.venue ?? '',
            ...identity.authors,
          ].some((text) => text.toLowerCase().includes(needle)),
      );
    return listed.sort((a, b) =>
      sort === 'title'
        ? a.identity.title.localeCompare(b.identity.title, 'vi')
        : sort === 'year'
          ? (b.identity.year ?? 0) - (a.identity.year ?? 0)
          : b.paper.createdAt.localeCompare(a.paper.createdAt),
    );
  }, [papers, identities, search, sort]);
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
          <div className={styles.libraryHead}>
            <h2>Bài báo đã nhập ({papers.length})</h2>
            {papers.length > 0 && (
              <div className={styles.libraryTools}>
                <TextField
                  label="Tìm bài"
                  size="sm"
                  type="search"
                  placeholder="Tên bài, tác giả, tên tệp"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <Select
                  label="Sắp xếp"
                  size="sm"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as Sort)}
                >
                  <option value="recent">Mới nhập trước</option>
                  <option value="title">Tên bài A–Z</option>
                  <option value="year">Năm mới nhất</option>
                </Select>
              </div>
            )}
          </div>
          {!papers.length ? (
            <p>Chưa có bài báo.</p>
          ) : !rows.length ? (
            <p>Không có bài nào khớp “{search.trim()}”.</p>
          ) : (
            <div className={styles.libraryScroll}>
              <table className={styles.library}>
                <thead>
                  <tr>
                    <th scope="col">Bài báo</th>
                    <th scope="col">Năm</th>
                    <th scope="col">Nơi đăng</th>
                    <th scope="col">Độ dài</th>
                    <th scope="col">Ngày nhập</th>
                    <th scope="col">
                      <span className={styles.hidden}>Thao tác</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ paper, identity }) => (
                    <tr key={paper.id}>
                      <th scope="row">
                        <Link className={styles.paperTitle} to={`/papers/${paper.id}`}>
                          {identity.title}
                        </Link>
                        {identity.authors.length > 0 && (
                          <span className={styles.paperMeta}>{authorsShort(identity.authors)}</span>
                        )}
                        <span className={styles.paperMeta}>
                          {[
                            identity.titleSource === 'file' ? null : paper.source.fileName || paper.title,
                            SOURCE_NOTE[identity.titleSource],
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </th>
                      <td>{identity.year ?? '—'}</td>
                      <td>{identity.venue ?? '—'}</td>
                      <td>
                        {paper.source.pageCount ? `${paper.source.pageCount} trang · ` : ''}
                        {paper.sections.length} mục · {paper.paragraphs.length} đoạn
                      </td>
                      <td>{new Date(paper.createdAt).toLocaleDateString('vi')}</td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Xoá ${identity.title}`}
                          onClick={(event) => {
                            setTrigger(event.currentTarget);
                            setDeleting(paper);
                          }}
                        >
                          Xoá
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {deleting && (
        <Dialog
          title="Xoá bài báo này?"
          description={`Bài báo ${identities.get(deleting.id)?.title ?? deleting.title} sẽ bị xoá. Nhật ký vẫn được giữ lại.`}
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
