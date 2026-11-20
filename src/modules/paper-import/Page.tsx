import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authorsShort, paperIdentity, type PaperIdentity } from '@/core/paperIdentity';
import type { PaperSummary } from '@/core/schemas/paper';
import { PaperSizeError } from '@/shared/paper/sizeGuard';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Dropzone } from '@/shared/ui/Dropzone';
import { PageHeader } from '@/shared/ui/PageHeader';
import { Dialog } from '@/shared/ui/Dialog';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { Tabs } from '@/shared/ui/Tabs';
import { importPaperFile } from './importPaperFile';
import { LibraryPanel } from './LibraryPanel';
import styles from './page.module.css';
import { Empty, Loading } from '@/shared/ui/StateNote';

type Sort = 'recent' | 'title' | 'year';
const SOURCE_NOTE: Partial<Record<PaperIdentity['titleSource'], string>> = {
  detected: 'Tên dò từ trang đầu',
  file: 'Tên tệp · chưa có metadata',
};

export default function Page() {
  const repo = useRepositories();
  const navigate = useNavigate();
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [identities, setIdentities] = useState(new Map<string, PaperIdentity>());
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [detail, setDetail] = useState('');
  const [deleting, setDeleting] = useState<PaperSummary | null>(null);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [view, setView] = useState<'papers' | 'library'>('papers');
  const load = useCallback(() => {
    void Promise.all([repo.papers.listSummaries(), repo.paperContext.list(), repo.library.list()])
      .then(([saved, contexts, library]) => {
        setPapers(saved);
        setLoaded(true);
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
        setLoaded(true);
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
      <PageHeader title="Bài báo" />
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
          <Dropzone
            inputLabel="Chọn tệp bài báo"
            title="Kéo thả bài báo vào đây, hoặc bấm để chọn tệp"
            hint="PDF, LaTeX, Markdown hoặc văn bản. Tệp được tách ngay trên máy này; PDF gốc chỉ lên kho lab khi bạn đăng nhập."
            accept=".pdf,.tex,.md,.txt,application/pdf,text/plain,text/markdown"
            busy={busy}
            status={progress || 'Đang xử lý tệp…'}
            onFile={(file) => void read(file)}
          />
          {error && (
            <div role="alert" className={styles.importError}>
              {error}
              {detail && (
                <details>
                  <summary>Chi tiết kỹ thuật</summary>
                  {detail}
                </details>
              )}
            </div>
          )}
          <div className={styles.libraryHead}>
            <h2>Bài báo đã nhập{loaded ? ` (${papers.length})` : ''}</h2>
            {papers.length > 0 && (
              <div className={styles.libraryTools}>
                <TextField
                  label="Tìm bài"
                  hideLabel
                  size="sm"
                  type="search"
                  placeholder="Tìm theo title, tác giả, tên tệp"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <Select
                  label="Sắp xếp"
                  hideLabel
                  size="sm"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as Sort)}
                >
                  <option value="recent">Mới nhập trước</option>
                  <option value="title">Title A–Z</option>
                  <option value="year">Năm mới nhất</option>
                </Select>
              </div>
            )}
          </div>
          {!loaded ? (
            <Loading label="Đang tải danh sách bài báo…" />
          ) : !papers.length ? (
            <Empty title="Chưa có bài nào." hint="Bài bạn nhập sẽ hiện ở đây." />
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
                        {paper.sectionCount} section · {paper.paragraphCount} paragraph
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
