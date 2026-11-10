import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { expect, it, vi } from 'vitest';
import { RUN_ALL, type JobFacts, type JobId, type JobReport } from './paperJobs';
import { RunAllCard } from './RunAllCard';

const labels = {
  snapshot: 'Snapshot',
  measure: 'Đo lường',
  rhetoric: 'Validity và Moves',
  arguments: 'Lập luận',
  batch: 'Chất lượng viết',
  stance: 'Giọng văn',
  probe: 'Độ bền điểm',
  review: 'Phản biện AI',
} satisfies Record<JobId, string>;

/** Stands in for the paper page: fake analyses that finish (or fail) when started. */
function Harness({
  done = [],
  failing,
  order,
  onRunChecks = () => {},
}: {
  done?: JobId[];
  failing?: JobId;
  order: JobId[];
  onRunChecks?: () => void;
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
      estimate: 3,
      ready: true,
      start: async () => {
        order.push(id);
        if (id !== failing) setFinished((old) => [...old, id]);
      },
    };
    facts[id] = { running: false, done: isDone, estimate: 3, ready: true, startable: true };
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
      onOpen={() => {}}
      onRunChecks={onRunChecks}
    />
  );
}

it('P3 confirms the total once, skips analyses that already have a result, and runs the rest in order', async () => {
  const order: JobId[] = [];
  const onRunChecks = vi.fn();
  render(<Harness done={['snapshot', 'batch']} order={order} onRunChecks={onRunChecks} />);
  fireEvent.click(screen.getByRole('button', { name: 'Phân tích toàn bài' }));
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getAllByText('Đã có kết quả, bỏ qua')).toHaveLength(2);
  expect(within(dialog).getByText(/Tổng ước tính: ~12 lượt gọi AI cho 4 phân tích/)).toBeInTheDocument();
  expect(order).toEqual([]);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Chạy 4 phân tích' }));
  expect(await screen.findByText('Đã chạy xong 4 phân tích.', {}, { timeout: 4000 })).toBeInTheDocument();
  expect(order).toEqual(['measure', 'rhetoric', 'arguments', 'stance']);
  expect(onRunChecks).toHaveBeenCalledTimes(1);
});

it('P3 stops at the first analysis that does not finish instead of spending on the rest', async () => {
  const order: JobId[] = [];
  render(<Harness failing="rhetoric" order={order} />);
  fireEvent.click(screen.getByRole('button', { name: 'Phân tích toàn bài' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chạy 6 phân tích' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Đã dừng ở “Validity và Moves”'), {
    timeout: 4000,
  });
  expect(order).toEqual(['snapshot', 'measure', 'rhetoric']);
});

it('P3 cancelling the confirmation starts nothing', () => {
  const order: JobId[] = [];
  render(<Harness order={order} />);
  fireEvent.click(screen.getByRole('button', { name: 'Phân tích toàn bài' }));
  fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(order).toEqual([]);
});
