import { useEffect, useMemo, useState } from 'react';
import { normalizeDoi } from '@/core/library/doi';
import { buildPaperModel, paperModelToJats, sentenceIndex } from '@/core/paperModel';
import type { Paper, PaperContextRecord, PaperMetadata as Metadata } from '@/core/schemas';
import { arxivDoiFromFileName, metadataFromLibrary, paperDoi, referenceList } from '@/core/scholarlyContext';
import { downloadJson, downloadText } from '@/shared/calibration/download';
import { createScholarClient } from '@/shared/scholar/client';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { ActionBar } from '@/shared/ui/ActionBar';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { TextField } from '@/shared/ui/TextField';
import {
  draftFrom,
  metadataFromDraft,
  paperModelFileName,
  SOURCE_LABELS,
  type MetadataDraft,
} from './metadataForm';
import styles from './snapshot.module.css';

const FORMATS: Record<Paper['source']['kind'], string> = {
  pdf: 'PDF',
  latex: 'LaTeX',
  markdown: 'Markdown',
  text: 'Văn bản',
};
const FIELDS: { name: Exclude<keyof MetadataDraft, 'authors'>; label: string; hint?: string }[] = [
  { name: 'title', label: 'Tên' },
  { name: 'year', label: 'Năm' },
  { name: 'venue', label: 'Tạp chí / Nơi đăng' },
  { name: 'volume', label: 'Tập' },
  { name: 'issue', label: 'Số' },
  { name: 'pages', label: 'Trang' },
  { name: 'doi', label: 'DOI' },
  { name: 'keywords', label: 'Từ khoá', hint: 'Cách nhau bằng dấu phẩy.' },
];
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
  const [draft, setDraft] = useState<MetadataDraft | null>(null);
  const [formError, setFormError] = useState('');
  const counts = useMemo(
    () => ({ sentences: sentenceIndex(paper).length, references: referenceList(paper).length }),
    [paper],
  );
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
  async function save(next: Metadata, checkedDoi: string | null = next.doi) {
    // Same record the DOI lookup writes; a paper with no lookup yet gets a fresh one.
    const at = next.fetchedAt;
    setRecord(
      await repo.paperContext.save({
        schemaVersion: 1,
        paperId: paper.id,
        checkedAt: record?.checkedAt ?? at,
        paperDoi: checkedDoi ?? record?.paperDoi ?? null,
        checked: record?.checked ?? 0,
        found: record?.found ?? 0,
        retracted: record?.retracted ?? [],
        retractionChecked: record?.retractionChecked ?? false,
        metadata: next,
      }),
    );
  }
  async function submit() {
    if (!draft) return;
    const result = metadataFromDraft(draft, metadata, new Date().toISOString());
    if ('error' in result) {
      setFormError(result.error);
      return;
    }
    try {
      await save(result.metadata);
      if (result.metadata.doi) setDoi(result.metadata.doi);
      setDraft(null);
      setFormError('');
    } catch {
      setFormError('Không lưu được thông tin. Vui lòng thử lại.');
    }
  }
  async function downloadModel(jats = false) {
    // Read at click time so the file carries the labels as they stand now, decisions included.
    try {
      const [insights, stance] = await Promise.all([
        repo.paperInsights.get(paper.id),
        repo.stance.get(paper.id),
      ]);
      const model = buildPaperModel({ paper, metadata, insights, stance, now: new Date() });
      const name = paperModelFileName(model.document.metadata.title);
      if (jats) {
        const xml = paperModelToJats(model);
        if (new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror')) {
          throw new Error('Invalid XML');
        }
        downloadText(name.replace(/\.json$/u, '.jats.xml'), xml, 'application/xml');
      } else {
        downloadJson(name, model);
      }
    } catch {
      setMessage(
        jats
          ? 'Không tạo được article.xml (JATS). Vui lòng thử lại.'
          : 'Không tạo được paper-model.json. Vui lòng thử lại.',
      );
    }
  }
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
      await save(found, value);
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
    ['Từ khoá', metadata?.keywords.length ? metadata.keywords.join(', ') : null],
  ];
  return (
    <Card>
      <h2>Metadata</h2>
      <ActionBar
        status={
          running ? (
            <span role="status">Đang tra cứu…</span>
          ) : metadata ? (
            `Nguồn: ${SOURCE_LABELS[metadata.source]} · ${new Date(metadata.fetchedAt).toLocaleString('vi-VN')}`
          ) : (
            'Chưa có metadata. Chỉ DOI được gửi tới OpenAlex.'
          )
        }
      >
        <TextField label="DOI" size="sm" value={doi} onChange={(event) => setDoi(event.target.value)} />
        <Button variant="primary" disabled={running || !doi.trim()} onClick={() => void lookup()}>
          {record?.metadata ? 'Tra cứu lại' : 'Tra cứu metadata'}
        </Button>
        <Button
          disabled={running || !!draft}
          onClick={() => {
            setFormError('');
            setDraft(draftFrom(metadata, paper.title, doi));
          }}
        >
          Sửa thông tin
        </Button>
      </ActionBar>
      {message && <p role="alert">{message}</p>}
      {!doi && (
        <p className={styles.note}>
          Không tìm thấy DOI trong bài hoặc tên tệp. Bạn có thể nhập DOI để tra cứu.
        </p>
      )}
      {draft ? (
        <form
          className={styles.form}
          aria-label="Sửa thông tin bài báo"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className={styles.formGrid}>
            {FIELDS.map(({ name, label, hint }) => (
              <TextField
                key={name}
                label={label}
                hint={hint}
                inputMode={name === 'year' ? 'numeric' : undefined}
                value={draft[name]}
                onChange={(event) => setDraft({ ...draft, [name]: event.target.value })}
              />
            ))}
          </div>
          <TextField
            multiline
            label="Tác giả"
            hint="Mỗi dòng một tác giả, viết như trong bài."
            rows={4}
            value={draft.authors}
            onChange={(event) => setDraft({ ...draft, authors: event.target.value })}
          />
          {formError && <p role="alert">{formError}</p>}
          <div className={styles.formActions}>
            <Button type="submit" variant="primary">
              Lưu
            </Button>
            <Button
              onClick={() => {
                setDraft(null);
                setFormError('');
              }}
            >
              Huỷ
            </Button>
          </div>
        </form>
      ) : (
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
      )}
      <section className={styles.model} aria-label="Paper model">
        <h3>Paper model</h3>
        <p className={styles.note}>
          {counts.sentences} câu · {counts.references} tài liệu tham khảo
        </p>
        <Button size="sm" onClick={() => void downloadModel()}>
          Tải paper-model.json
        </Button>
        <Button size="sm" onClick={() => void downloadModel(true)}>
          Tải article.xml (JATS)
        </Button>
      </section>
    </Card>
  );
}
