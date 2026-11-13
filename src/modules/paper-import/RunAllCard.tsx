import { useRef, useState, type RefObject } from 'react';
import { BATCH_CONCURRENCY } from '@/core/batch';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Dialog } from '@/shared/ui/Dialog';
import {
  describeStale,
  RUN_ALL,
  RUN_ALL_CONCURRENCY,
  type JobFacts,
  type JobId,
  type JobReport,
  type RunProgress,
} from './paperJobs';
import styles from './page.module.css';

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm' }
  | { kind: 'running'; active: JobId[]; completed: number; total: number }
  | { kind: 'stopped'; at: JobId }
  | { kind: 'finished'; done: JobId[]; incomplete: JobId[]; skipped: JobId[] };

/** Measured median wall time of one router call (docs/UX_EVAL_PAPER_ONE_BUTTON.md). */
const SECONDS_PER_CALL = 30;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs missing AI analyses with a bounded queue after confirmation of the estimated cost. */
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
  onProgress?: (progress: RunProgress | null) => void;
  /** Only the button and its status, for a toolbar; the explanation is in the confirmation. */
  compact?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const stopping = useRef(false);
  const rows = RUN_ALL.map((id) => ({ id, fact: facts[id] }));
  const loading = rows.some((row) => !row.fact?.ready);
  const remaining = rows.filter((row) => row.fact?.ready && (!row.fact.done || row.fact.stale)).length;
  const remainingNames = rows
    .filter((row) => row.fact?.ready && (!row.fact.done || row.fact.stale))
    .map((row) => labels[row.id])
    .join(', ');
  const todo = rows.filter(
    (row) =>
      row.fact?.ready &&
      (!row.fact.done || row.fact.stale) &&
      !row.fact.running &&
      (row.fact.startable || row.fact.resumable),
  );
  const calls = (fact: JobFacts | undefined) =>
    fact?.resumable ? (fact.resumeEstimate ?? fact.estimate) : (fact?.estimate ?? 0);
  const total = todo.reduce((sum, row) => sum + calls(row.fact), 0);
  // The batch runs paragraph requests in a pool; other analyses remain sequential.
  const longest = Math.max(
    0,
    ...todo.map((row) => calls(row.fact) / (row.id === 'batch' ? BATCH_CONCURRENCY : 1)),
  );
  const minutes = Math.ceil((Math.max(longest, total / RUN_ALL_CONCURRENCY) * SECONDS_PER_CALL) / 60);

  async function run(ids: JobId[]) {
    stopping.current = false;
    onRunChecks();
    const active = new Set<JobId>();
    const done: JobId[] = [];
    const incomplete: JobId[] = [];
    const skipped = RUN_ALL.filter((id) => !ids.includes(id));
    let next = 0;
    let stoppedAt: JobId | null = null;
    const update = () => {
      const running = [...active];
      setPhase({ kind: 'running', active: running, completed: done.length, total: ids.length });
      onProgress?.({ labels: running.map((id) => labels[id]), completed: done.length, total: ids.length });
    };
    async function worker() {
      while (!stopping.current && next < ids.length) {
        const id = ids[next++];
        if (!id) break;
        const job = jobs.current[id];
        const start = job?.resume ?? job?.start;
        if (!job || !start || (job.done && !job.stale) || job.running) {
          skipped.push(id);
          continue;
        }
        active.add(id);
        update();
        let outcome: unknown;
        try {
          outcome = await start();
        } catch {
          outcome = 'error';
        }
        if (outcome === 'declined') {
          stopping.current = true;
          stoppedAt = id;
          for (const runningId of active) if (runningId !== id) jobs.current[runningId]?.stop?.();
        }
        // Reports arrive after React commits the panel's final state.
        await wait(60);
        while (jobs.current[id]?.running) await wait(100);
        active.delete(id);
        if (outcome === 'declined') continue;
        if (outcome !== 'error' && jobs.current[id]?.done && !jobs.current[id]?.stale) {
          done.push(id);
        } else {
          incomplete.push(id);
        }
        if (!stopping.current) update();
      }
    }
    await Promise.all(Array.from({ length: Math.min(RUN_ALL_CONCURRENCY, ids.length) }, () => worker()));
    if (stopping.current) {
      onProgress?.(null);
      setPhase({ kind: 'stopped', at: stoppedAt ?? ids[0] ?? 'digest' });
    } else {
      const orderedIncomplete = RUN_ALL.filter((id) => incomplete.includes(id));
      onProgress?.({ incomplete: orderedIncomplete.map((id) => labels[id]) });
      setPhase({ kind: 'finished', done, incomplete: orderedIncomplete, skipped });
    }
  }
  const status = (fact: JobFacts | undefined) =>
    !fact?.ready
      ? 'Đang tải…'
      : fact.running
        ? 'Đang chạy'
        : fact.done && !fact.stale
          ? 'Đã có kết quả, bỏ qua'
          : fact.resumable
            ? `Tiếp tục · ~${fact.resumeEstimate ?? fact.estimate} lượt`
            : fact.stale
              ? `Kết quả cũ (${describeStale(fact.stale)}) · ~${fact.estimate} lượt gọi AI`
              : !fact.startable
                ? 'Cần chỉnh trong tab đó trước, bỏ qua'
                : `~${fact.estimate} lượt gọi AI`;
  const action =
    phase.kind === 'running' ? (
      <Button
        variant="danger"
        onClick={() => {
          stopping.current = true;
          for (const id of phase.active) jobs.current[id]?.stop?.();
        }}
      >
        Dừng
      </Button>
    ) : (
      <Button
        disabled={loading}
        title={remainingNames ? `Còn lại: ${remainingNames}` : undefined}
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
          Đang chạy {phase.active.length} phân tích: {phase.active.map((id) => labels[id]).join(', ')} ·{' '}
          {phase.completed}/{phase.total} xong.
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
      {phase.kind === 'finished' && (
        <div role="status">
          <p>
            Xong {phase.done.length}/{phase.done.length + phase.incomplete.length} phân tích
            {phase.incomplete.length > 0 &&
              ` · ${phase.incomplete.length} chưa trọn vẹn: ${phase.incomplete.map((id) => labels[id]).join(', ')}`}
          </p>
          {phase.incomplete.map((id) => (
            <Button key={id} size="sm" variant="ghost" onClick={() => onOpen(id)}>
              Mở {labels[id]}
            </Button>
          ))}
          <ul>
            {RUN_ALL.map((id) => (
              <li key={id}>
                {labels[id]}:{' '}
                {phase.done.includes(id)
                  ? 'Xong'
                  : phase.incomplete.includes(id)
                    ? 'Chưa trọn vẹn'
                    : 'Bỏ qua'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
  const dialog = phase.kind === 'confirm' && (
    <Dialog
      title="Phân tích toàn bài?"
      description="Mỗi phân tích gửi các mục đã chọn của bài cho AI. Kết quả AI được chấp nhận mặc định; bạn bác bỏ những gì không đúng."
      onClose={() => setPhase({ kind: 'idle' })}
    >
      <p>Còn lại: {remainingNames || 'Không có'}.</p>
      <ul className={styles.runAllList}>
        {rows.map((row) => (
          <li key={row.id}>
            <span>{labels[row.id]}</span>
            <span className={styles.muted}>{status(row.fact)}</span>
          </li>
        ))}
      </ul>
      <p>
        Tổng ước tính: ~{total} lượt gọi AI cho {todo.length} phân tích (chưa tính thử lại). Các phân tích
        chạy song song, khoảng {minutes} phút
        {todo.some((row) => row.id === 'batch') && '; Coherence & sentences chiếm phần lớn'}. Mỗi phân tích
        vẫn có trần riêng. Các kiểm tra không dùng AI cũng được chạy nếu chưa có.
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
            Chạy song song các phân tích AI còn thiếu, dùng phạm vi mục đã nhớ cho bài này và giới hạn chạy
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
