import { useEffect, useState } from 'react';
import { normalizeDoi } from '@/core/library/doi';
import type { Paper, PaperContextRecord, PaperMetadata as Metadata } from '@/core/schemas';
import { arxivDoiFromFileName, metadataFromLibrary, paperDoi } from '@/core/scholarlyContext';
import { createScholarClient } from '@/shared/scholar/client';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { ActionBar } from '@/shared/ui/ActionBar';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { TextField } from '@/shared/ui/TextField';
import styles from './snapshot.module.css';

const FORMATS: Record<Paper['source']['kind'], string> = {
  pdf: 'PDF',
  latex: 'LaTeX',
  markdown: 'Markdown',
  text: 'Văn bản',
};
const TYPES: Record<string, string> = {
  article: 'Bài báo',
  preprint: 'Bản thảo (preprint)',
  review: 'Bài tổng quan',
  'book-chapter': 'Chương sách',
  book: 'Sách',
  dissertation: 'Luận án',
};

export function PaperMetadata({ paper }: { paper: Paper }) {
  const repo = useRepositories();
  const [record, setRecord] = useState<PaperContextRecord>();
  const [library, setLibrary] = useState<Metadata | null>(null);
  const [doi, setDoi] = useState(() => paperDoi(paper) ?? arxivDoiFromFileName(paper.source.fileName) ?? '');
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.all([repo.paperContext.get(paper.id), repo.library.list()]).then(([saved, items]) => {
      if (!active) return;
      setRecord(saved);
      const linked = items.find((item) => item.paper_id === paper.id);
      if (linked) {
        setLibrary(metadataFromLibrary(linked, linked.updatedAt));
        setDoi((current) => current || linked.doi);
      }
      if (saved?.metadata?.doi) setDoi(saved.metadata.doi);
    });
    return () => {
      active = false;
    };
  }, [paper.id, repo]);
  const metadata = record?.metadata ?? library;
  async function lookup() {
    const value = normalizeDoi(doi);
    if (!value) {
      setMessage('DOI chưa hợp lệ.');
      return;
    }
    setRunning(true);
    setMessage('');
    try {
      // Only the DOI leaves the browser; the Unpaywall email is not used here.
      const found = await createScholarClient({}).paperMetadata(value);
      if (!found) {
        setMessage('OpenAlex không có bản ghi cho DOI này.');
        return;
      }
      setRecord(
        await repo.paperContext.save({
          schemaVersion: 1,
          paperId: paper.id,
          checkedAt: record?.checkedAt ?? found.fetchedAt,
          paperDoi: value,
          checked: record?.checked ?? 0,
          found: record?.found ?? 0,
          retracted: record?.retracted ?? [],
          retractionChecked: record?.retractionChecked ?? false,
          metadata: found,
        }),
      );
    } catch {
      setMessage('Không tra cứu được OpenAlex. Vui lòng thử lại.');
    } finally {
      setRunning(false);
    }
  }
  const rows: [string, string | null][] = [
    ['Tên', metadata?.title ?? paper.title],
    [
      'Tệp',
      `${FORMATS[paper.source.kind]}${paper.source.pageCount ? ` · ${paper.source.pageCount} trang` : ''} · ${paper.source.fileName}`,
    ],
    ['Loại', metadata?.type ? (TYPES[metadata.type] ?? metadata.type) : null],
    ['Năm', metadata?.year ? String(metadata.year) : null],
    [
      metadata ? `Tác giả (${metadata.authors.length})` : 'Tác giả',
      metadata?.authors.length ? metadata.authors.join(', ') : null,
    ],
    ['Tạp chí / Nơi đăng', metadata?.venue ?? null],
    ['Tập', metadata?.volume ?? null],
    ['Số', metadata?.issue ?? null],
    ['Trang', metadata?.pages ?? null],
    [
      'Số lần được trích (OpenAlex)',
      metadata?.citedBy === null || metadata?.citedBy === undefined ? null : String(metadata.citedBy),
    ],
    ['Chủ đề', metadata?.topic ?? null],
  ];
  return (
    <Card>
      <h2>Metadata</h2>
      <ActionBar
        status={
          running ? (
            <span role="status">Đang tra cứu…</span>
          ) : metadata ? (
            `Nguồn: ${metadata.source === 'openalex' ? 'OpenAlex' : 'Thư viện DOI'} · ${new Date(metadata.fetchedAt).toLocaleString('vi-VN')}`
          ) : (
            'Chưa có metadata. Chỉ DOI được gửi tới OpenAlex.'
          )
        }
      >
        <TextField label="DOI" size="sm" value={doi} onChange={(event) => setDoi(event.target.value)} />
        <Button variant="primary" disabled={running || !doi.trim()} onClick={() => void lookup()}>
          {record?.metadata ? 'Tra cứu lại' : 'Tra cứu metadata'}
        </Button>
      </ActionBar>
      {message && <p role="alert">{message}</p>}
      {!doi && (
        <p className={styles.note}>
          Không tìm thấy DOI trong bài hoặc tên tệp. Bạn có thể nhập DOI để tra cứu.
        </p>
      )}
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Trường</th>
            <th scope="col">Giá trị</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{value ?? <span className={styles.missing}>Chưa có</span>}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">DOI</th>
            <td>
              {metadata?.doi ? (
                <a href={`https://doi.org/${metadata.doi}`} target="_blank" rel="noreferrer">
                  {metadata.doi}
                </a>
              ) : (
                <span className={styles.missing}>Chưa có</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}
