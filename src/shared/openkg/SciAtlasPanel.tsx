import { useEffect, useId, useRef, useState } from 'react';
import {
  SCIATLAS_RANKINGS,
  type SciAtlasAnchors,
  type SciAtlasPaper,
  type SciAtlasRanking,
  type SciAtlasSearchResponse,
} from '@/core/openkg';
import { useAuth } from '@/shared/auth/authContext';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { SciAtlasAnchorEditor } from './SciAtlasAnchorEditor';
import { SciAtlasResults } from './SciAtlasResults';
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

/**
 * "Bài liên quan theo SciAtlas": shows the anchors it will send, lets the user edit them, and lists SciAtlas's
 * related papers. Results live in this component only; nothing is saved.
 */
export function SciAtlasPanel({
  anchors: initial,
  known,
  onAdd,
}: {
  anchors: SciAtlasAnchors;
  known?: (paper: SciAtlasPaper) => string | undefined;
  onAdd?: (paper: SciAtlasPaper) => Promise<void>;
}) {
  const heading = useId();
  const { getIdToken } = useAuth();
  const [anchors, setAnchors] = useState(initial);
  const [limitYears, setLimitYears] = useState(Boolean(initial.years));
  const [from, setFrom] = useState(String(initial.years?.from ?? ''));
  const [to, setTo] = useState(String(initial.years?.to ?? ''));
  const [topK, setTopK] = useState('10');
  const [ranking, setRanking] = useState<SciAtlasRanking>('balanced');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SciAtlasSearchResponse>();
  const [error, setError] = useState<{ message: string; detail: string }>();
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

  const ready = anchors.keywords.length + anchors.titles.length > 0;
  const fromYear = yearOf(from);
  const toYear = yearOf(to);
  const yearsInvalid = limitYears && (fromYear === null || toYear === null || fromYear > toYear);

  async function search() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setTouched(true);
    setBusy(true);
    setError(undefined);
    try {
      const response = await searchSciAtlas(
        {
          keywords: anchors.keywords,
          titles: anchors.titles,
          references: anchors.references,
          ...(limitYears && fromYear !== null && toYear !== null
            ? { after: `${fromYear}-01-01`, before: `${toYear}-12-31` }
            : {}),
          topK: Number(topK),
          ranking,
        },
        await getIdToken(),
        current.signal,
      );
      if (!current.signal.aborted) setResult(response);
    } catch (cause) {
      if (current.signal.aborted) return;
      setResult(undefined);
      setError(
        cause instanceof SciAtlasError
          ? { message: cause.message, detail: cause.detail }
          : { message: 'Không tra cứu được SciAtlas.', detail: String(cause) },
      );
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby={heading} aria-busy={busy}>
      <h3 id={heading}>Bài liên quan theo SciAtlas</h3>
      <p className={styles.muted}>Kết quả từ SciAtlas (OpenKG), không lưu lại.</p>
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
      </div>
      {!ready && <p className={styles.muted}>Cần ít nhất một keyword hoặc title để tìm.</p>}
      {error && (
        <div>
          <p role="alert">{error.message}</p>
          {error.detail && (
            <details>
              <summary>Chi tiết kỹ thuật</summary>
              {error.detail}
            </details>
          )}
        </div>
      )}
      {result && <SciAtlasResults papers={result.papers} known={known} onAdd={onAdd} />}
    </section>
  );
}
