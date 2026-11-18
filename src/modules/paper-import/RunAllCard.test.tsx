import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { expect, it, vi } from 'vitest';
import { RUN_ALL, type JobFacts, type JobId, type JobReport } from './paperJobs';
import { RunAllCard } from './RunAllCard';

const labels = {
  digest: 'Summary',
  snapshot: 'Snapshot',
  measure: 'Đo lường',
  rhetoric: 'Validity và Moves',
  arguments: 'Argument',
  batch: 'Chất lượng viết',
  stance: 'Giọng văn',
  probe: 'Độ bền điểm',
  review: 'Phản biện AI',
} satisfies Record<JobId, string>;

/** Stands in for the paper page: fake analyses that finish (or fail) when started. */
function Harness({
  done = [],
  failing,
  stale,
  order,
  onRunChecks = () => {},
  declined,
  resumable,
  gate,
  onResume = () => {},
  onOpen = () => {},
}: {
  done?: JobId[];
  failing?: JobId;
  stale?: JobId;
  order: JobId[];
  onRunChecks?: () => void;
  declined?: JobId;
  resumable?: JobId;
  gate?: () => Promise<void>;
  onResume?: () => void;
  onOpen?: (job: JobId) => void;
}) {
  const [finished, setFinished] = useState<JobId[]>(done);
  const jobs = useRef<Partial<Record<JobId, JobReport>>>({});
  const facts: Partial<Record<JobId, JobFacts>> = {};
  const reports: Partial<Record<JobId, JobReport>> = {};
  for (const id of RUN_ALL) {
    const isDone = finished.includes(id);
    reports[id] = {
      running: false,
      done: isDone,
      stale: id === stale && !finished.includes((id + ':rerun') as JobId) ? ['model'] : null,
      estimate: 3,
      ready: true,
      start: async () => {
        order.push(id);
        if (gate) await gate();
        if (id === declined) return 'declined';
        if (id !== failing) setFinished((old) => [...old, id, (id + ':rerun') as JobId]);
      },
      resume:
        id === resumable
          ? async () => {
              onResume();
              order.push(id);
              setFinished((old) => [...old, id]);
            }
          : null,
      resumeEstimate: id === resumable ? 1 : undefined,
    };
    facts[id] = {
      running: false,
      done: isDone,
      stale: reports[id]?.stale,
      estimate: 3,
      ready: true,
      startable: true,
      resumable: id === resumable,
      resumeEstimate: id === resumable ? 1 : undefined,
      sections: [],
    };
  }
  // As on the page: the latest reports are published after every render.
  useEffect(() => {
    jobs.current = reports;
  });
  return (
    <RunAllCard
      jobs={jobs}
      facts={facts}
      labels={labels}
      onPrepare={() => {}}
      onOpen={onOpen}
      onRunChecks={onRunChecks}
    />
  );
}

it('P3 confirms the total once, skips analyses that already have a result, and runs the rest in order', async () => {
  const order: JobId[] = [];
  const onRunChecks = vi.fn();
  render(<Harness done={['snapshot', 'batch']} order={order} onRunChecks={onRunChecks} />);
  fireEvent.click(screen.getByRole('button', { name: 'Phân tích bài báo' }));
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getAllByText('Đã có kết quả, bỏ qua')).toHaveLength(2);
  expect(within(dialog).getByText(/tổng ước tính ~15 lượt gọi AI/)).toBeInTheDocument();
  expect(within(dialog).getByText('Nâng cao')).toBeInTheDocument();
  expect(order).toEqual([]);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Chạy 5 phân tích' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Phân tích lại' })).toBeInTheDocument());
  expect(order).toEqual(['digest', 'measure', 'rhetoric', 'arguments', 'stance']);
  expect(onRunChecks).toHaveBeenCalledTimes(1);
});

it('U1 continues after an incomplete analysis and lists the partial result', async () => {
  const order: JobId[] = [];
  const onOpen = vi.fn();
  render(<Harness failing="rhetoric" order={order} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Phân tích bài báo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chạy 7 phân tích' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Xong một phần'));
  expect(screen.getByRole('button', { name: 'Xem Claim và evidence' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Xem Claim và evidence' }));
  expect(onOpen).toHaveBeenCalledWith('arguments');
  expect(order).toEqual(RUN_ALL);
});

it('U1 stops launching jobs when consent is declined', async () => {
  const order: JobId[] = [];
  render(<Harness declined="digest" order={order} />);
  fireEvent.click(screen.getByRole('button', { name: 'Phân tích bài báo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chạy 7 phân tích' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Đã dừng ở “Summary”'));
  expect(order).toEqual(RUN_ALL.slice(0, 3));
});

it('U2 prefers the saved resume point and estimates its remaining calls', async () => {
  const order: JobId[] = [];
  const onResume = vi.fn();
  render(<Harness resumable="measure" order={order} onResume={onResume} />);
  fireEvent.click(screen.getByRole('button', { name: 'Phân tích bài báo' }));
  expect(screen.getByText('Tiếp tục · ~1 lượt')).toBeInTheDocument();
  expect(screen.getByText(/tổng ước tính ~19 lượt/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Chạy 7 phân tích' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Phân tích lại' })).toBeInTheDocument());
  expect(order.filter((id) => id === 'measure')).toHaveLength(1);
  expect(onResume).toHaveBeenCalledOnce();
});

it('U3 runs at most three analyses at once', async () => {
  const order: JobId[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  render(<Harness order={order} gate={() => gate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Phân tích bài báo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chạy 7 phân tích' }));
  expect(order).toEqual(RUN_ALL.slice(0, 3));
  expect(screen.getByRole('status')).toHaveTextContent('Đang chạy');
  release();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Phân tích lại' })).toBeInTheDocument());
  expect(order).toEqual(RUN_ALL);
});

it('P3 cancelling the confirmation starts nothing', () => {
  const order: JobId[] = [];
  render(<Harness order={order} />);
  fireEvent.click(screen.getByRole('button', { name: 'Phân tích bài báo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(order).toEqual([]);
});

it('R6 includes stale completed analyses and shows their reason', async () => {
  const order: JobId[] = [];
  render(<Harness done={RUN_ALL} stale="rhetoric" order={order} />);
  fireEvent.click(screen.getByRole('button', { name: 'Phân tích bài báo' }));
  expect(screen.getByText('Kết quả cũ (model khác) · ~3 lượt gọi AI')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Chạy 1 phân tích' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Phân tích lại' })).toBeInTheDocument());
  expect(order).toEqual(['rhetoric']);
});

it('U5 offers analysis again when everything is current', () => {
  render(<Harness done={RUN_ALL} order={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Phân tích lại' }));
  expect(screen.getByRole('button', { name: 'Không còn gì để chạy' })).toBeDisabled();
});
