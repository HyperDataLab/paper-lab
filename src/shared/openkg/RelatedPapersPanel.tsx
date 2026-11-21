import { useEffect, useId, useRef, useState } from 'react';
import {
  SCIATLAS_RANKINGS,
  type SciAtlasAnchors,
  type SciAtlasPaper,
  type SciAtlasRanking,
  type SciAtlasSearchRequest,
} from '@/core/openkg';
import type { KgIngestResult, KgSearchResponse, KgStats } from '@/core/schemas/labKg';
import { useAuth } from '@/shared/auth/authContext';
import { enqueueLabKg, getLabKgStats, labKgIds, LabKgError, searchLabKg } from '@/shared/labKg/client';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { RelatedPaperResults } from './RelatedPaperResults';
import { SciAtlasAnchorEditor } from './SciAtlasAnchorEditor';
import { SciAtlasError, searchSciAtlas } from './sciatlas';
import styles from './sciatlas.module.css';

const RANKING_LABELS: Record<SciAtlasRanking, string> = {
  precision: 'Chính xác (precision)',
  balanced: 'Cân bằng (balanced)',
  discovery: 'Khám phá (discovery)',
  impact: 'Ảnh hưởng (impact)',
};
const TOP_K = ['5', '10', '20'];
const yearOf = (value: string) => (/^\d{4}$/u.test(value.trim()) ? Number(value) : null);
type Failure = { message: string; detail: string };
const failure = (cause: unknown, fallback: string): Failure =>
  cause instanceof SciAtlasError || cause instanceof LabKgError
    ? { message: cause.message, detail: cause.detail }
    : { message: fallback, detail: String(cause) };

function ErrorNote({ error }: { error: Failure }) {
  return (
    <div>
      <p role="alert">{error.message}</p>
      {error.detail && (
        <details>
          <summary>Chi tiết kỹ thuật</summary>
          {error.detail}
        </details>
      )}
    </div>
  );
}

/**
 * "Bài liên quan (KG của lab)": shows the anchors it will send, lets the user edit them, and lists related
 * papers from the lab KG. SciAtlas is only an id source: its answer is reduced to DOIs and OpenAlex ids, which
 * go to the KG ingest queue, and nothing else from it is shown or kept.
 */
export function RelatedPapersPanel({
  anchors: initial,
  known,
  onAdd,
}: {
  anchors: SciAtlasAnchors;
  known?: (paper: SciAtlasPaper) => string | undefined;
  onAdd?: (paper: SciAtlasPaper) => Promise<void>;
}) {
  const heading = useId();
  const { user, getIdToken } = useAuth();
  const uid = user?.uid;
  const [anchors, setAnchors] = useState(initial);
  const [limitYears, setLimitYears] = useState(Boolean(initial.years));
  const [from, setFrom] = useState(String(initial.years?.from ?? ''));
  const [to, setTo] = useState(String(initial.years?.to ?? ''));
  const [topK, setTopK] = useState('10');
  const [ranking, setRanking] = useState<SciAtlasRanking>('balanced');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KgSearchResponse>();
  const [error, setError] = useState<Failure>();
  const [pointerBusy, setPointerBusy] = useState(false);
  const [pointer, setPointer] = useState<{ ids: number; queued: KgIngestResult }>();
  const [pointerError, setPointerError] = useState<Failure>();
  const [stats, setStats] = useState<KgStats>();
  const [statsFailed, setStatsFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  // New anchors (a graph rebuilt after a keyword backfill) replace the shown ones only until the user edits
  // them or searches, so an edit or a result list is never thrown away by a rebuild.
  const [base, setBase] = useState(initial);
  const [touched, setTouched] = useState(false);
  if (base !== initial && !touched) {
    setBase(initial);
    setAnchors(initial);
    setLimitYears(Boolean(initial.years));
    setFrom(String(initial.years?.from ?? ''));
    setTo(String(initial.years?.to ?? ''));
  }
  const controller = useRef<AbortController>(undefined);
  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (!uid) return;
    const current = new AbortController();
    void (async () => {
      try {
        const next = await getLabKgStats(await getIdToken(), current.signal);
        if (!current.signal.aborted) {
          setStats(next);
          setStatsFailed(false);
        }
      } catch {
        if (!current.signal.aborted) setStatsFailed(true);
      }
    })();
    return () => current.abort();
  }, [uid, getIdToken, refresh]);

  const ready = anchors.keywords.length + anchors.titles.length > 0;
  const fromYear = yearOf(from);
  const toYear = yearOf(to);
  const yearsInvalid = limitYears && (fromYear === null || toYear === null || fromYear > toYear);
  const request = (): SciAtlasSearchRequest => ({
    keywords: anchors.keywords,
    titles: anchors.titles,
    references: anchors.references,
    ...(limitYears && fromYear !== null && toYear !== null
      ? { after: `${fromYear}-01-01`, before: `${toYear}-12-31` }
      : {}),
    topK: Number(topK),
    ranking,
  });

  async function search() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setTouched(true);
    setBusy(true);
    setError(undefined);
    try {
      const response = await searchLabKg(request(), await getIdToken(), current.signal);
      if (!current.signal.aborted) setResult(response);
    } catch (cause) {
      if (current.signal.aborted) return;
      setResult(undefined);
      setError(failure(cause, 'Không tìm được trong KG của lab.'));
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }

  async function findIds() {
    setTouched(true);
    setPointerBusy(true);
    setPointerError(undefined);
    setPointer(undefined);
    try {
      const token = await getIdToken();
      // Only the identifiers leave this call; titles, abstracts and scores from SciAtlas are dropped here.
      const ids = labKgIds((await searchSciAtlas(request(), token)).papers);
      const queued = ids.length
        ? await enqueueLabKg(ids, token, 'sciatlas_pointer')
        : { queued: 0, processed: 0, skipped: 0, errors: [] };
      setPointer({ ids: ids.length, queued });
    } catch (cause) {
      setPointerError(failure(cause, 'Không lấy được id từ SciAtlas.'));
    } finally {
      setPointerBusy(false);
      setRefresh((value) => value + 1);
    }
  }

  const waiting = stats ? stats.queue.pending + stats.queue.processing : 0;
  return (
    <section className={styles.panel} aria-labelledby={heading} aria-busy={busy}>
      <h3 id={heading}>Bài liên quan (KG của lab)</h3>
      <p className={styles.muted} role={uid ? 'status' : undefined}>
        KG của lab ·{' '}
        {!uid
          ? 'Cần đăng nhập'
          : statsFailed
            ? 'Không tải được số liệu'
            : stats
              ? `${stats.nodes.paper} bài · ${stats.nodes.keyword} keyword · ${waiting} đang chờ đưa vào`
              : 'Đang tải…'}
      </p>
      <SciAtlasAnchorEditor
        anchors={anchors}
        onChange={(next) => {
          setTouched(true);
          setAnchors(next);
        }}
      />
      <div className={styles.controls}>
        <Checkbox checked={limitYears} onChange={(event) => setLimitYears(event.currentTarget.checked)}>
          Giới hạn năm xuất bản
        </Checkbox>
        {limitYears && (
          <>
            <TextField
              label="Từ năm"
              size="sm"
              inputMode="numeric"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <TextField
              label="Đến năm"
              size="sm"
              inputMode="numeric"
              value={to}
              error={yearsInvalid ? 'Năm chưa hợp lệ.' : undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </>
        )}
        <SegmentedControl
          label="Số bài (top-k)"
          value={topK}
          onChange={setTopK}
          options={TOP_K.map((value) => ({ value, label: value }))}
        />
        <Select
          label="Cách xếp hạng"
          size="sm"
          value={ranking}
          onChange={(event) => setRanking(event.target.value as SciAtlasRanking)}
        >
          {SCIATLAS_RANKINGS.map((value) => (
            <option key={value} value={value}>
              {RANKING_LABELS[value]}
            </option>
          ))}
        </Select>
        <Button variant="primary" disabled={!ready || busy || yearsInvalid} onClick={() => void search()}>
          {busy ? 'Đang tìm…' : 'Tìm'}
        </Button>
        <Button disabled={!ready || pointerBusy || yearsInvalid} onClick={() => void findIds()}>
          {pointerBusy ? 'Đang lấy id…' : 'Tìm thêm id từ SciAtlas'}
        </Button>
      </div>
      {!ready && <p className={styles.muted}>Cần ít nhất một keyword hoặc title để tìm.</p>}
      <p className={styles.muted}>
        SciAtlas chỉ cung cấp DOI / OpenAlex id; bài được đưa vào KG của lab với dữ liệu từ OpenAlex.
      </p>
      {pointer && (
        <p className={styles.muted} role="status">
          {pointer.ids
            ? `SciAtlas gợi ý ${pointer.ids} id · Đã xếp vào KG ${pointer.queued.queued} · Bỏ qua ${pointer.queued.skipped} · Lỗi ${pointer.queued.errors.length}`
            : 'SciAtlas không gợi ý id nào cho các anchor này.'}
        </p>
      )}
      {pointerError && <ErrorNote error={pointerError} />}
      {error && <ErrorNote error={error} />}
      {result && (
        <RelatedPaperResults
          papers={result.papers}
          empty={
            result.hint === 'kg_empty'
              ? 'KG của lab chưa có bài nào. Hãy đưa bài vào KG từ Library hoặc corpus, hoặc tìm thêm id từ SciAtlas.'
              : 'KG của lab chưa có bài nào khớp với các anchor này.'
          }
          known={known}
          onAdd={onAdd}
        />
      )}
    </section>
  );
}
