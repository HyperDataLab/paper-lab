import { useRef, useState, type RefObject } from 'react';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Dialog } from '@/shared/ui/Dialog';
import { describeStale, RUN_ALL, type JobFacts, type JobId, type JobReport } from './paperJobs';
import styles from './page.module.css';

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm' }
  | { kind: 'running'; current: JobId; index: number; total: number }
  | { kind: 'stopped'; at: JobId }
  | { kind: 'finished'; ran: number };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs every missing AI analysis one after another, after one confirmation that shows the total cost. */
export function RunAllCard({
  jobs,
  facts,
  labels,
  onPrepare,
  onOpen,
  onRunChecks,
  onProgress,
  compact = false,
}: {
  /** The panels' latest reports, including the functions that start and stop them. */
  jobs: RefObject<Partial<Record<JobId, JobReport>>>;
  facts: Partial<Record<JobId, JobFacts>>;
  labels: Record<JobId, string>;
  /** Mounts every analysis panel so each can report what it has and what it would cost. */
  onPrepare: () => void;
  onOpen: (job: JobId) => void;
  /** Runs the checks that use no AI, when the paper has none yet. */
  onRunChecks: () => void;
  onProgress?: (progress: { label: string; index: number; total: number } | null) => void;
  /** Only the button and its status, for a toolbar; the explanation is in the confirmation. */
  compact?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const stopping = useRef(false);
  const rows = RUN_ALL.map((id) => ({ id, fact: facts[id] }));
  const loading = rows.some((row) => !row.fact?.ready);
  const remaining = rows.filter((row) => row.fact?.ready && (!row.fact.done || row.fact.stale)).length;
  const todo = rows.filter(
    (row) => row.fact?.ready && (!row.fact.done || row.fact.stale) && !row.fact.running && row.fact.startable,
  );
  const total = todo.reduce((sum, row) => sum + (row.fact?.estimate ?? 0), 0);

  async function run(ids: JobId[]) {
    stopping.current = false;
    onRunChecks();
    let ran = 0;
    let last: JobId | null = null;
    for (const [index, id] of ids.entries()) {
      if (stopping.current) break;
      const job = jobs.current[id];
      if (!job?.start || (job.done && !job.stale) || job.running) continue;
      last = id;
      onProgress?.({ label: labels[id], index: index + 1, total: ids.length });
      setPhase({ kind: 'running', current: id, index, total: ids.length });
      await job.start();
      // The panel reports its new state on its next render; give it a moment, then wait out the run.
      await wait(60);
      while (jobs.current[id]?.running) await wait(100);
      if (stopping.current) break;
      // Declined consent, a reached ceiling or an error: stop here rather than spend on the rest.
      if (!jobs.current[id]?.done || jobs.current[id]?.stale) {
        onProgress?.(null);
        return setPhase({ kind: 'stopped', at: id });
      }
      ran += 1;
    }
    onProgress?.(null);
    setPhase(stopping.current && last ? { kind: 'stopped', at: last } : { kind: 'finished', ran });
  }
  const status = (fact: JobFacts | undefined) =>
    !fact?.ready
      ? 'Đang tải…'
      : fact.running
        ? 'Đang chạy'
        : fact.stale
          ? `Kết quả cũ (${describeStale(fact.stale)}) · ~${fact.estimate} lượt gọi AI`
          : fact.done
            ? 'Đã có kết quả, bỏ qua'
            : !fact.startable
              ? 'Cần chỉnh trong tab đó trước, bỏ qua'
              : `~${fact.estimate} lượt gọi AI`;
  const action =
    phase.kind === 'running' ? (
      <Button
        variant="danger"
        onClick={() => {
          stopping.current = true;
          jobs.current[phase.current]?.stop?.();
        }}
      >
        Dừng
      </Button>
    ) : (
      <Button
        disabled={loading}
        hidden={!loading && remaining === 0}
        onClick={() => {
          onPrepare();
          setPhase({ kind: 'confirm' });
        }}
      >
        Phân tích toàn bài · còn {loading ? '…' : remaining}
      </Button>
    );
  const progress = (
    <>
      {phase.kind === 'running' && (
        <p role="status">
          Đang chạy {phase.index + 1}/{phase.total}: {labels[phase.current]}. Bạn có thể mở tab khác trong lúc
          chờ.
        </p>
      )}
      {phase.kind === 'stopped' && (
        <p role="alert">
          Đã dừng ở “{labels[phase.at]}”.{' '}
          <Button size="sm" variant="ghost" onClick={() => onOpen(phase.at)}>
            Mở {labels[phase.at]}
          </Button>{' '}
          để xem lý do hoặc chạy tiếp.
        </p>
      )}
      {phase.kind === 'finished' && <p role="status">Đã chạy xong {phase.ran} phân tích.</p>}
    </>
  );
  const dialog = phase.kind === 'confirm' && (
    <Dialog
      title="Phân tích toàn bài?"
      description="Mỗi phân tích gửi các mục đã chọn của bài cho AI. Kết quả AI được chấp nhận mặc định; bạn bác bỏ những gì không đúng."
      onClose={() => setPhase({ kind: 'idle' })}
    >
      <ul className={styles.runAllList}>
        {rows.map((row) => (
          <li key={row.id}>
            <span>{labels[row.id]}</span>
            <span className={styles.muted}>{status(row.fact)}</span>
          </li>
        ))}
      </ul>
      <p>
        Tổng ước tính: ~{total} lượt gọi AI cho {todo.length} phân tích (chưa tính thử lại). Mỗi phân tích vẫn
        có trần riêng. Các kiểm tra không dùng AI cũng được chạy nếu chưa có.
      </p>
      <div className={styles.runActions}>
        <Button data-dialog-initial-focus onClick={() => setPhase({ kind: 'idle' })}>
          Huỷ
        </Button>
        <Button
          variant="primary"
          disabled={loading || todo.length === 0}
          onClick={() => void run(todo.map((row) => row.id))}
        >
          {loading ? 'Đang tải…' : todo.length ? `Chạy ${todo.length} phân tích` : 'Không còn gì để chạy'}
        </Button>
      </div>
    </Dialog>
  );
  if (compact)
    return (
      <div className={styles.runAllCompact}>
        {action}
        {progress}
        {dialog}
      </div>
    );
  return (
    <Card padding="md">
      <div className={styles.runAll}>
        <div>
          <h2>Phân tích toàn bài</h2>
          <p className={styles.muted}>
            Chạy lần lượt các phân tích AI còn thiếu, dùng phạm vi mục đã nhớ cho bài này và giới hạn chạy
            trong Cài đặt. Phân tích đã có kết quả được bỏ qua.
          </p>
        </div>
        {action}
      </div>
      {progress}
      {dialog}
    </Card>
  );
}
