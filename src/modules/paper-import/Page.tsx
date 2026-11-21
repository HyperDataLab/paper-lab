import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authorsShort, paperIdentity, type PaperIdentity } from '@/core/paperIdentity';
import type { PaperSummary } from '@/core/schemas/paper';
import { PaperSizeError } from '@/shared/paper/sizeGuard';
import { useHubProjectId, useRepositories } from '@/shared/storage/StorageProvider';
import { useAuth } from '@/shared/auth/authContext';
import { Button } from '@/shared/ui/Button';
import { Dropzone } from '@/shared/ui/Dropzone';
import { PageHeader } from '@/shared/ui/PageHeader';
import { Dialog } from '@/shared/ui/Dialog';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { Tabs } from '@/shared/ui/Tabs';
import { importPaperFile, importResearchHubFile } from './importPaperFile';
import { listResearchHubProjectFiles, type ResearchHubProjectFile } from '@/shared/pdfStore/researchHubFiles';
import { LibraryPanel } from './LibraryPanel';
import styles from './page.module.css';
import { Empty, Loading } from '@/shared/ui/StateNote';

type Sort = 'recent' | 'title' | 'year';
const SOURCE_NOTE: Partial<Record<PaperIdentity['titleSource'], string>> = {
  detected: 'Tên dò từ trang đầu',
  file: 'Tên tệp · chưa có metadata',
};
const isPdf = (file: ResearchHubProjectFile) =>
  file.contentType.toLowerCase() === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
const fileSize = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export default function Page() {
  const repo = useRepositories();
  const projectId = useHubProjectId() ?? '';
  const { getIdToken } = useAuth();
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
  const [projectFiles, setProjectFiles] = useState<ResearchHubProjectFile[]>([]);
  const [projectFilesLoading, setProjectFilesLoading] = useState(true);
  const [projectFilesError, setProjectFilesError] = useState('');
  const [importingFileId, setImportingFileId] = useState<string | null>(null);
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
  const fetchProjectFiles = useCallback(async () => {
    const token = await getIdToken();
    if (!token) throw new Error('Không nhận được phiên ResearchHub.');
    return (await listResearchHubProjectFiles(projectId, token)).filter(isPdf);
  }, [getIdToken, projectId]);
  const loadProjectFiles = useCallback(async () => {
    setProjectFilesLoading(true);
    setProjectFilesError('');
    try {
      setProjectFiles(await fetchProjectFiles());
    } catch (cause) {
      setProjectFilesError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProjectFilesLoading(false);
    }
  }, [fetchProjectFiles]);
  useEffect(() => {
    let active = true;
    void fetchProjectFiles()
      .then((files) => {
        if (active) setProjectFiles(files);
      })
      .catch((cause: unknown) => {
        if (active) setProjectFilesError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setProjectFilesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchProjectFiles]);
  async function read(file: File) {
    if (busy) return;
    setBusy(true);
    setError('');
    setDetail('');
    setProgress('');
    try {
      const paper = await importPaperFile(file, repo, {
        projectId,
        onProgress: setProgress,
        getIdToken,
      });
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
  async function importProjectFile(file: ResearchHubProjectFile) {
    if (busy) return;
    setBusy(true);
    setImportingFileId(file.id);
    setError('');
    setDetail('');
    setProgress('Đang tải tài liệu từ ResearchHub…');
    try {
      const paper = await importResearchHubFile(file, repo, { projectId, getIdToken, onProgress: setProgress });
      navigate(`/papers/${paper.id}`);
    } catch (cause) {
      setError('Không thể nhập tài liệu từ ResearchHub.');
      setDetail(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setImportingFileId(null);
      setProgress('');
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
          <section className={styles.projectFiles} aria-labelledby="research-hub-files-title">
            <div className={styles.projectFilesHead}>
              <div>
                <h2 id="research-hub-files-title">PDF trong project ResearchHub</h2>
                <p>Tệp gốc được giữ trong kho ResearchHub. Chọn một tệp để mở và phân tích trong PaperLab.</p>
              </div>
              <Button size="sm" onClick={() => void loadProjectFiles()} disabled={projectFilesLoading}>
                {projectFilesLoading ? 'Đang tải…' : 'Tải lại'}
              </Button>
            </div>
            {projectFilesLoading ? (
              <Loading label="Đang tải danh sách tệp project…" />
            ) : projectFilesError ? (
              <div className={styles.projectFilesError} role="alert">
                <span>Không thể tải tệp từ ResearchHub.</span>
                <details><summary>Chi tiết kỹ thuật</summary>{projectFilesError}</details>
              </div>
            ) : projectFiles.length === 0 ? (
              <p className={styles.projectFilesEmpty}>Project chưa có PDF nào trong kho ResearchHub.</p>
            ) : (
              <ul className={styles.projectFileList}>
                {projectFiles.map((file) => (
                  <li key={file.id} className={styles.projectFileRow}>
                    <span className={styles.projectFileType} aria-hidden="true">PDF</span>
                    <span className={styles.projectFileName} title={file.name}>{file.name}</span>
                    <span className={styles.projectFileMeta}>{fileSize(file.size)} · {new Date(file.uploadedAt).toLocaleDateString('vi')}</span>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy}
                      onClick={() => void importProjectFile(file)}
                    >
                      {importingFileId === file.id ? 'Đang nhập…' : 'Mở để phân tích'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
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
