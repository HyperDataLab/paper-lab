import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  EMPTY_FILTER,
  bestOpenLink,
  filterLibrary,
  libraryStatus,
  parseDoiInput,
  statusCounts,
  taxonomyFacets,
  toRis,
  type LibraryFilter,
  type LibraryStatus,
} from '@/core/library';
import type { LibraryItem } from '@/core/schemas';
import { downloadText } from '@/shared/calibration/download';
import { getScholarEmail } from '@/shared/scholar/settings';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { Chip } from '@/shared/ui/Chip';
import { Dialog } from '@/shared/ui/Dialog';
import { DataTable } from '@/shared/ui/DataTable';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { useLibrary } from './useLibrary';
import { GrobidQueueStatus, GrobidQueueSummary } from '@/shared/pdfStore/GrobidQueueStatus';
import styles from './library.module.css';
import { Loading } from '@/shared/ui/StateNote';

const PAGE_SIZE = 50;
const STATUS: Record<
  LibraryStatus,
  { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' }
> = {
  pending: { label: 'Đang tra cứu', tone: 'neutral' },
  file: { label: 'Đã có file', tone: 'success' },
  open: { label: 'Có bản mở', tone: 'accent' },
  none_found: { label: 'Chưa thấy bản mở', tone: 'neutral' },
  unknown: { label: 'Chưa rõ', tone: 'warning' },
  not_found: { label: 'DOI không tồn tại', tone: 'danger' },
  failed: { label: 'Tra cứu lỗi', tone: 'danger' },
};
const FILTERS: (LibraryStatus | 'all')[] = [
  'all',
  'open',
  'file',
  'none_found',
  'unknown',
  'not_found',
  'failed',
];

export function LibraryPanel() {
  const library = useLibrary();
  const { items, running, done } = library;
  const [text, setText] = useState('');
  const [report, setReport] = useState('');
  const [skipped, setSkipped] = useState<string[]>([]);
  const [problem, setProblem] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>(EMPTY_FILTER);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const attachTarget = useRef<LibraryItem | null>(null);

  async function addFrom(input: string) {
    const { dois, unmatched } = parseDoiInput(input);
    setSkipped(unmatched);
    if (!dois.length) {
      setReport('Không tìm thấy DOI nào.');
      return;
    }
    try {
      const result = await library.add(dois);
      setReport(
        `Đã thêm ${result.added} DOI · ${result.duplicates} đã có sẵn · ${unmatched.length} dòng không có DOI`,
      );
      setText('');
      setProblem('');
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
    }
  }
  async function readCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await addFrom(await file.text());
  }
  async function attach(item: LibraryItem, file: File) {
    setBusyRow(item.id);
    setProblem('');
    try {
      await library.attach(item, file);
    } catch (cause) {
      setProblem(`Không đọc được tệp: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setBusyRow(null);
    }
  }
  function drop(event: DragEvent<HTMLTableRowElement>, item: LibraryItem) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void attach(item, file);
  }
  const update = (patch: Partial<LibraryFilter>) => {
    setFilter((old) => ({ ...old, ...patch }));
    setPage(0);
    setSelected([]);
  };
  if (library.loading) return <Loading label="Đang tải thư viện…" />;

  const shown = filterLibrary(items, filter);
  const counts = statusCounts(items);
  const facets = taxonomyFacets(items, filter);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const visible = shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const picked = items.filter((item) => selected.includes(item.id));
  const targets = picked.length ? picked : shown;
  const arxiv = targets.filter((item) => item.arxiv_id && !item.paper_id);
  const pending = items.filter((item) => item.lookup === 'pending');
  const failed = targets.filter((item) => item.lookup === 'failed' || item.access === 'unknown');
  const allVisible = visible.length > 0 && visible.every((item) => selected.includes(item.id));
  const option = (facet: { value: string; count: number }) => (
    <option key={facet.value} value={facet.value}>
      {facet.value} ({facet.count})
    </option>
  );
  return (
    <div className={styles.panel}>
      <h2 className={styles.composerTitle}>Thêm bài báo theo DOI</h2>
      <div className={styles.composer}>
        <TextField
          multiline
          rows={3}
          placeholder={
            'Dán DOI, đường dẫn doi.org hoặc cả đoạn văn có DOI. Ví dụ:\n10.1038/s41586-020-2649-2'
          }
          label="Dán DOI, đường dẫn doi.org, hoặc cả đoạn văn có DOI"
          hideLabel
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className={styles.composerFoot}>
          <p className={styles.note}>
            Chỉ DOI được gửi tới OpenAlex, Crossref, Europe PMC{getScholarEmail() ? ' và Unpaywall' : ''}.{' '}
            {!getScholarEmail() && <Link to="/settings">Thêm email trong Cài đặt</Link>}
          </p>
          <Button onClick={() => csvInput.current?.click()}>Nhập tệp CSV</Button>
          <input
            ref={csvInput}
            className={styles.hidden}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            aria-label="Chọn tệp CSV"
            onChange={(event) => void readCsv(event)}
          />
          <Button variant="primary" disabled={!text.trim()} onClick={() => void addFrom(text)}>
            Thêm và tra cứu
          </Button>
        </div>
      </div>
      {report && <p role="status">{report}</p>}
      {skipped.length > 0 && (
        <details>
          <summary>{skipped.length} dòng không có DOI</summary>
          <ul>
            {skipped.slice(0, 20).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
      {problem && <div role="alert">{problem}</div>}
      {library.error && <div role="alert">Không thể tải thư viện: {library.error}</div>}
      {items.length > 0 && (
        <section className={styles.resultsPanel} aria-label="Danh sách thư viện bài báo">
          <div className={styles.statusFilters}>
            {FILTERS.map((status) => {
              const count = status === 'all' ? items.length : (counts[status] ?? 0);
              if (status !== 'all' && !count) return null;
              return (
                <Chip
                  key={status}
                  count={count}
                  aria-pressed={filter.status === status}
                  onClick={() => update({ status })}
                >
                  {status === 'all' ? 'Tất cả' : STATUS[status].label}
                </Chip>
              );
            })}
          </div>
          <div className={styles.filterControls}>
            <div className={styles.queryFilter}>
              <TextField
                label="Tìm theo tên, tác giả, DOI"
                size="sm"
                placeholder="Tên bài, tác giả hoặc DOI"
                value={filter.query}
                onChange={(event) => update({ query: event.target.value })}
              />
            </div>
            <div className={styles.facetFilter}>
              <Select
                label="Lĩnh vực lớn"
                size="sm"
                value={filter.domain}
                onChange={(event) => update({ domain: event.target.value, field: '', topic: '' })}
              >
                <option value="">Tất cả</option>
                {facets.domains.map(option)}
              </Select>
            </div>
            <div className={styles.facetFilter}>
              <Select
                label="Ngành"
                size="sm"
                value={filter.field}
                onChange={(event) => update({ field: event.target.value, topic: '' })}
              >
                <option value="">Tất cả</option>
                {facets.fields.map(option)}
              </Select>
            </div>
            <div className={styles.facetFilter}>
              <Select
                label="Chủ đề"
                size="sm"
                value={filter.topic}
                onChange={(event) => update({ topic: event.target.value })}
              >
                <option value="">Tất cả</option>
                {facets.topics.map(option)}
              </Select>
            </div>
          </div>
          <div className={styles.bulk}>
            <span>{picked.length ? `Đã chọn ${picked.length}` : `Đang hiện ${shown.length} bài`}</span>
            {running ? (
              <>
                <span role="status">
                  Đang xử lý {done.finished}/{done.total}
                </span>
                <Button size="sm" onClick={library.cancel}>
                  Dừng
                </Button>
              </>
            ) : (
              <>
                {pending.length > 0 && (
                  <Button size="sm" variant="primary" onClick={() => void library.lookupAll(pending)}>
                    Tiếp tục tra cứu ({pending.length})
                  </Button>
                )}
                {arxiv.length > 0 && (
                  <Button size="sm" onClick={() => void library.downloadArxiv(arxiv)}>
                    Tải từ arXiv ({arxiv.length})
                  </Button>
                )}
                {failed.length > 0 && (
                  <Button size="sm" onClick={() => void library.retry(failed)}>
                    Tra cứu lại ({failed.length})
                  </Button>
                )}
              </>
            )}
            <Button
              size="sm"
              disabled={!targets.length}
              onClick={() =>
                downloadText('paperlab-library.ris', toRis(targets), 'application/x-research-info-systems')
              }
            >
              Xuất RIS ({targets.length})
            </Button>
            {picked.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                Xoá khỏi thư viện
              </Button>
            )}
          </div>
          <input
            ref={pdfInput}
            className={styles.hidden}
            type="file"
            accept=".pdf,application/pdf"
            aria-label="Chọn tệp PDF"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file && attachTarget.current) void attach(attachTarget.current, file);
            }}
          />
          <GrobidQueueSummary statuses={library.grobidStatuses} />
          <DataTable className={styles.libraryTable} scrollClassName={styles.scroll}>
            <thead>
              <tr>
                <th>
                  <Checkbox
                    checked={allVisible}
                    onChange={(event) =>
                      setSelected(event.target.checked ? visible.map((item) => item.id) : [])
                    }
                  >
                    <span className={styles.hidden}>Chọn tất cả trang này</span>
                  </Checkbox>
                </th>
                <th>Bài báo</th>
                <th>Phân loại</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const status = libraryStatus(item);
                const link = bestOpenLink(item);
                return (
                  <tr
                    key={item.id}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => drop(event, item)}
                  >
                    <td>
                      <Checkbox
                        checked={selected.includes(item.id)}
                        onChange={(event) =>
                          setSelected((old) =>
                            event.target.checked ? [...old, item.id] : old.filter((id) => id !== item.id),
                          )
                        }
                      >
                        <span className={styles.hidden}>Chọn {item.doi}</span>
                      </Checkbox>
                    </td>
                    <td>
                      <a href={`https://doi.org/${item.doi}`} target="_blank" rel="noreferrer">
                        {item.title ?? item.doi}
                      </a>
                      <div className={styles.note}>
                        {[
                          item.authors.slice(0, 3).join(', ') +
                            (item.authors.length > 3 ? ' và cộng sự' : ''),
                          item.year,
                          item.venue,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td className={styles.note}>
                      {item.taxonomy ? (
                        <>
                          <div>{item.taxonomy.field}</div>
                          <div>{item.taxonomy.topic}</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>
                      {library.grobidStatuses[item.id] && (
                        <div>
                          <GrobidQueueStatus value={library.grobidStatuses[item.id]} />
                        </div>
                      )}
                      {item.file_matches_title === false && (
                        <Badge tone="warning">File có thể không khớp</Badge>
                      )}
                      {item.error && <div className={styles.note}>{item.error}</div>}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        {item.paper_id ? (
                          <Link to={`/papers/${item.paper_id}`}>Mở bài</Link>
                        ) : item.lookup === 'not_found' ? null : (
                          <>
                            {item.arxiv_id && (
                              <Button
                                size="sm"
                                disabled={running || busyRow === item.id}
                                onClick={() => void library.downloadArxiv([item])}
                              >
                                Tải từ arXiv
                              </Button>
                            )}
                            {link && !item.arxiv_id && (
                              <a href={link} target="_blank" rel="noreferrer">
                                Mở bản mở
                              </a>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyRow === item.id}
                              onClick={() => {
                                attachTarget.current = item;
                                pdfInput.current?.click();
                              }}
                            >
                              {busyRow === item.id ? 'Đang đọc…' : 'Gắn PDF'}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
          {pages > 1 && (
            <div className={styles.pager}>
              <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Trang trước
              </Button>
              <span>
                Trang {page + 1}/{pages}
              </span>
              <Button size="sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                Trang sau
              </Button>
            </div>
          )}
          <p className={styles.tableNote}>
            Bài chưa có file: mở bản mở, tải PDF về rồi kéo thả vào đúng dòng hoặc bấm Gắn PDF. PDF được đọc
            trên máy của bạn; khi đăng nhập tài khoản lab, bản gốc được lưu thêm vào kho chung của lab.
          </p>
        </section>
      )}
      {confirming && (
        <Dialog
          title={`Xoá ${picked.length} mục khỏi thư viện?`}
          description="Chỉ xoá dòng trong thư viện. Các bài đã nhập vẫn được giữ."
          onClose={() => setConfirming(false)}
        >
          <div className={styles.actions}>
            <Button data-dialog-initial-focus onClick={() => setConfirming(false)}>
              Huỷ
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void library.remove(selected).then(() => {
                  setSelected([]);
                  setConfirming(false);
                });
              }}
            >
              Xoá khỏi thư viện
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
