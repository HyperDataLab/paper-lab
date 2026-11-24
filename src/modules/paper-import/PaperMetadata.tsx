import { Check, ClipboardCopy, FileCode2, FileJson, Info, Pencil, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { normalizeDoi } from '@/core/library/doi';
import { paperBibtex, paperRis } from '@/core/extraction';
import { paperIdentity } from '@/core/paperIdentity';
import { mergeGrobidMetadata, usableGrobid, type GrobidField } from '@/core/grobid/merge';
import { buildPaperModel, paperModelToJats, sentenceIndex } from '@/core/paperModel';
import type { Paper, PaperContextRecord, PaperMetadata as Metadata } from '@/core/schemas';
import { arxivDoiFromFileName, metadataFromLibrary, paperDoi, referenceList } from '@/core/scholarlyContext';
import { downloadJson, downloadText } from '@/shared/calibration/download';
import { createScholarClient } from '@/shared/scholar/client';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { ActivityStatus } from '@/shared/ui/ActivityStatus';
import { SheetSection } from '@/shared/ui/SheetSection';
import { TextField } from '@/shared/ui/TextField';
import { useGrobidState } from './grobidContext';
import { GrobidStatus } from './GrobidStatus';
import { PublishPaperModel } from './PublishPaperModel';
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
  { name: 'title', label: 'Title' },
  { name: 'year', label: 'Năm' },
  { name: 'venue', label: 'Tạp chí / Nơi đăng' },
  { name: 'volume', label: 'Tập' },
  { name: 'issue', label: 'Số' },
  { name: 'pages', label: 'Trang' },
  { name: 'doi', label: 'DOI' },
  { name: 'keywords', label: 'Keywords', hint: 'Cách nhau bằng dấu phẩy.' },
];
const FILLED_LABELS: Record<GrobidField, string> = {
  title: 'tên',
  authors: 'tác giả',
  year: 'năm',
  doi: 'DOI',
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
  const [draft, setDraft] = useState<MetadataDraft | null>(null);
  const [formError, setFormError] = useState('');
  const [copiedTitle, setCopiedTitle] = useState(false);
  const grobidRecord = useGrobidState().record;
  const grobid = useMemo(() => usableGrobid(grobidRecord), [grobidRecord]);
  const counts = useMemo(
    () => ({
      sentences: sentenceIndex(paper).length,
      references: referenceList(paper, undefined, grobid).length,
    }),
    [paper, grobid],
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
  // Stored metadata first; GROBID's header only fills what is still empty.
  const { metadata, filled } = useMemo(
    () => mergeGrobidMetadata(record?.metadata ?? library, grobidRecord, paper),
    [record, library, grobidRecord, paper],
  );
  async function save(next: Metadata, checkedDoi: string | null = next.doi) {
    // Same record the DOI lookup writes; a paper with no lookup yet gets a fresh one.
    const at = next.fetchedAt;
    const current = await repo.paperContext.get(paper.id);
    setRecord(
      await repo.paperContext.save({
        ...current,
        schemaVersion: 1,
        paperId: paper.id,
        checkedAt: current?.checkedAt ?? at,
        paperDoi: checkedDoi ?? current?.paperDoi ?? null,
        checked: current?.checked ?? 0,
        found: current?.found ?? 0,
        retracted: current?.retracted ?? [],
        retractionChecked: current?.retractionChecked ?? false,
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
  async function buildModel() {
    const [insights, stance] = await Promise.all([
      repo.paperInsights.get(paper.id),
      repo.stance.get(paper.id),
    ]);
    return buildPaperModel({ paper, metadata, insights, stance, grobid, now: new Date() });
  }
  async function downloadModel(jats = false) {
    // Read at click time so the file carries the labels as they stand now, decisions included.
    try {
      const model = await buildModel();
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
    ['Title', metadata?.title ?? paper.title],
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
    ['Keywords', metadata?.keywords.length ? metadata.keywords.join(', ') : null],
  ];
  const missing = [
    ...rows.filter(([, value]) => value === null).map(([label]) => label),
    ...(metadata?.doi ? [] : ['DOI']),
  ];
  const fullTitle = metadata?.title ?? paper.title;
  async function copyTitle() {
    try {
      await navigator.clipboard.writeText(fullTitle);
      setCopiedTitle(true);
      window.setTimeout(() => setCopiedTitle(false), 1400);
    } catch {
      setMessage('Không thể sao chép tiêu đề.');
    }
  }
  return (
    <div className={styles.metadata}>
      {running ? (
        <ActivityStatus label="Đang tra cứu metadata…" />
      ) : (
        <p className={styles.sourceLine}>
          <Info size={14} aria-hidden="true" />
          {metadata
            ? `Nguồn: ${SOURCE_LABELS[metadata.source]} · ${new Date(metadata.fetchedAt).toLocaleString('vi-VN')}${filled.length && metadata.source !== 'grobid' ? ` · thêm từ GROBID: ${filled.map((field) => FILLED_LABELS[field]).join(', ')}` : ''}`
            : 'Chưa có metadata. Chỉ DOI được gửi tới OpenAlex.'}
        </p>
      )}
      <GrobidStatus />

      <div className={styles.fullTitle}>
        <div>
          <strong>Tiêu đề đầy đủ</strong>
          <p>{fullTitle}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void copyTitle()}>
          {copiedTitle ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <ClipboardCopy size={14} aria-hidden="true" />
          )}
          {copiedTitle ? 'Đã sao chép' : 'Sao chép'}
        </Button>
      </div>

      <SheetSection title="Tra cứu theo DOI">
        <form
          className={styles.lookup}
          onSubmit={(event) => {
            event.preventDefault();
            void lookup();
          }}
        >
          <TextField
            label="DOI"
            hideLabel
            placeholder="10.xxxx/…"
            value={doi}
            onChange={(event) => setDoi(event.target.value)}
          />
          <Button type="submit" variant="primary" disabled={running || !doi.trim()}>
            <Search size={16} aria-hidden="true" />
            {record?.metadata ? 'Tra cứu lại' : 'Tra cứu metadata'}
          </Button>
        </form>
        {!doi && (
          <p className={styles.note}>
            Không tìm thấy DOI trong bài hoặc tên tệp. Bạn có thể nhập DOI để tra cứu.
          </p>
        )}
        {message && <p role="alert">{message}</p>}
      </SheetSection>

      <SheetSection
        title={
          <span className={styles.sectionHead}>
            Thông tin bài
            {!draft && (
              <Button
                size="sm"
                variant="ghost"
                disabled={running}
                onClick={() => {
                  setFormError('');
                  setDraft(draftFrom(metadata, paper.title, doi));
                }}
              >
                <Pencil size={14} aria-hidden="true" />
                Sửa thông tin
              </Button>
            )}
          </span>
        }
      >
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
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(null);
                  setFormError('');
                }}
              >
                Huỷ
              </Button>
              <Button type="submit" variant="primary">
                Lưu
              </Button>
            </div>
          </form>
        ) : (
          <>
            <dl className={styles.facts}>
              {rows
                .filter(([, value]) => value !== null)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              {metadata?.doi && (
                <div>
                  <dt>DOI</dt>
                  <dd>
                    <a href={`https://doi.org/${metadata.doi}`} target="_blank" rel="noreferrer">
                      {metadata.doi}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            {missing.length > 0 && (
              <p className={styles.missing}>Chưa có: {missing.join(', ').toLowerCase()}.</p>
            )}
          </>
        )}
      </SheetSection>

      <SheetSection title="Xuất trích dẫn">
        <div className={styles.downloads}>
          {(['RIS', 'BibTeX'] as const).map((format) => (
            <Button
              key={format}
              onClick={() => {
                const citation = {
                  title: metadata?.title || paperIdentity(paper).title,
                  authors: metadata?.authors ?? [],
                  year: metadata?.year ?? null,
                  venue: metadata?.venue ?? null,
                  doi: metadata?.doi ?? null,
                  volume: metadata?.volume ?? null,
                  issue: metadata?.issue ?? null,
                  pages: metadata?.pages ?? null,
                };
                downloadText(
                  format === 'RIS' ? 'paper.ris' : 'paper.bib',
                  format === 'RIS' ? paperRis(citation) : paperBibtex(citation),
                  format === 'RIS' ? 'application/x-research-info-systems' : 'text/plain;charset=utf-8',
                );
              }}
            >
              {format} của bài này
            </Button>
          ))}
        </div>
      </SheetSection>
      <SheetSection title="Paper model">
        <p className={styles.note}>
          Toàn bộ bài dưới dạng có cấu trúc: {counts.sentences} câu · {counts.references}{' '}
          {counts.references === 1 ? 'reference' : 'references'}.
        </p>
        <div className={styles.downloads}>
          <Button onClick={() => void downloadModel()}>
            <FileJson size={16} aria-hidden="true" />
            Tải paper-model.json
          </Button>
          <Button onClick={() => void downloadModel(true)}>
            <FileCode2 size={16} aria-hidden="true" />
            Tải article.xml (JATS)
          </Button>
        </div>
        <PublishPaperModel paperId={paper.id} buildModel={buildModel} />
      </SheetSection>
    </div>
  );
}
