import { useRef, useState, type ChangeEvent } from 'react';
import {
  GOLD_MIN_PAPERS,
  GOLD_TARGETS,
  goldVerdict,
  MeasurementGoldSchema,
  scoreAgainstGold,
  sumScores,
  type GoldScore,
} from '@/core/measurement';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Upload } from 'lucide-react';
import styles from './page.module.css';

const ROWS: { key: keyof typeof GOLD_TARGETS; label: string }[] = [
  { key: 'metricPrecision', label: 'Precision phát hiện metric' },
  { key: 'metricRecall', label: 'Recall phát hiện metric' },
  { key: 'numericExact', label: 'Số và đơn vị khớp chính xác (bảng đọc đúng)' },
  { key: 'evidenceLocation', label: 'Evidence đúng vị trí' },
  { key: 'protocolPrecision', label: 'Precision trường protocol REPORTED' },
  { key: 'falseReported', label: 'Tỉ lệ ghi nhầm thành REPORTED' },
];
const VERDICT = {
  not_measured: { label: 'Chưa đo', tone: 'neutral' },
  met: { label: 'Đạt mục tiêu', tone: 'success' },
  not_met: { label: 'Chưa đạt', tone: 'warning' },
} as const;
const target = (key: keyof typeof GOLD_TARGETS) => {
  const { min, max } = GOLD_TARGETS[key];
  return min !== undefined ? `≥ ${min}` : `≤ ${max}`;
};

/** Scores the unedited AI output, so human corrections cannot flatter the numbers. */
export function MeasurementGoldCard() {
  const repo = useRepositories();
  const input = useRef<HTMLInputElement>(null);
  const [score, setScore] = useState<GoldScore>();
  const [papers, setPapers] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState('');
  async function read(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    try {
      setError('');
      const scores: GoldScore[] = [];
      const missing: string[] = [];
      const stored = await repo.papers.list();
      for (const file of files) {
        const gold = MeasurementGoldSchema.parse(JSON.parse(await file.text()) as unknown);
        const paper = stored.find((item) => item.source.sha256 === gold.paper_sha256);
        const run = paper && (await repo.measurements.get(paper.id))?.runs.at(-1);
        if (run) scores.push(scoreAgainstGold(run.profile, gold));
        else missing.push(file.name);
      }
      setScore(sumScores(scores));
      setPapers(scores.length);
      setSkipped(missing);
    } catch (cause) {
      setError(`Tệp không đúng định dạng: ${String(cause)}`);
    }
  }
  return (
    <Card>
      <div className={styles.cardHead}>
        <div>
          <h2>Đo chất lượng trích xuất measurement</h2>
          <p>
            So sánh kết quả AI gốc với nhãn của người. Các ngưỡng là mục tiêu, chưa phải kết quả đã đạt; cần
            tối thiểu {GOLD_MIN_PAPERS} bài và hai người gán nhãn.
          </p>
        </div>
        <Button onClick={() => input.current?.click()}>
          <Upload size={16} aria-hidden="true" />
          Nhập tệp nhãn chuẩn
        </Button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          multiple
          hidden
          aria-label="Tệp nhãn chuẩn"
          onChange={(event) => void read(event)}
        />
      </div>
      {error && (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      )}
      <div className={styles.progress}>
        <p>
          <strong>{`Đã đo trên ${papers}/${GOLD_MIN_PAPERS} bài`}</strong>
          {score && (
            <span className={styles.muted}>
              {' '}
              · Lỗi do bộ đọc PDF: {score.parsingErrors} (tính riêng, không phải lỗi suy luận)
            </span>
          )}
        </p>
        <span className={styles.progressBar} aria-hidden="true">
          <span style={{ width: `${Math.min(100, (papers / GOLD_MIN_PAPERS) * 100)}%` }} />
        </span>
        {skipped.length > 0 && <p className={styles.muted}>Chưa có hồ sơ cho: {skipped.join(', ')}.</p>}
      </div>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th className={styles.num}>Kết quả</th>
              <th className={styles.num}>n</th>
              <th className={styles.num}>Mục tiêu</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(({ key, label }) => {
              const tally = score?.[key] ?? { hit: 0, n: 0 };
              const verdict = VERDICT[goldVerdict(key, tally)];
              return (
                <tr key={key}>
                  <td>{label}</td>
                  <td className={styles.num}>{tally.n ? (tally.hit / tally.n).toFixed(2) : '—'}</td>
                  <td className={styles.num}>{tally.n}</td>
                  <td className={styles.num}>{target(key)}</td>
                  <td>
                    <Badge tone={verdict.tone}>{verdict.label}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
