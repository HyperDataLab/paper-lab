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
  stale,
  order,
  onRunChecks = () => {},
}: {
  done?: JobId[];
  failing?: JobId;
  stale?: JobId;
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
      stale: id === stale && !finished.includes((id + ':rerun') as JobId) ? ['model'] : null,
      estimate: 3,
      ready: true,
      start: async () => {
        order.push(id);
        if (id !== failing) setFinished((old) => [...old, id, (id + ':rerun') as JobId]);
      },
    };
    facts[id] = {
      running: false,
      done: isDone,
      stale: reports[id]?.stale,
      estimate: 3,
      ready: true,
      startable: true,
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
      onOpen={() => {}}
      onRunChecks={onRunChecks}
    />
  );
}

it('P3 confirms the total once, skips analyses that already have a result, and runs the rest in order', async () => {
  const order: JobId[] = [];
  const onRunChecks = vi.fn();
  render(<Harness done={['snapshot', 'batch']} order={order} onRunChecks={onRunChecks} />);
  fireEvent.click(screen.getByRole('button', { name: /Phân tích toàn bài · còn/ }));
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getAllByText('Đã có kết quả, bỏ qua')).toHaveLength(2);
  expect(within(dialog).getByText(/Tổng ước tính: ~15 lượt gọi AI cho 5 phân tích/)).toBeInTheDocument();
  expect(order).toEqual([]);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Chạy 5 phân tích' }));
  expect(await screen.findByText('Đã chạy xong 5 phân tích.', {}, { timeout: 4000 })).toBeInTheDocument();
  expect(order).toEqual(['digest', 'measure', 'rhetoric', 'arguments', 'stance']);
  expect(onRunChecks).toHaveBeenCalledTimes(1);
});

it('P3 stops at the first analysis that does not finish instead of spending on the rest', async () => {
  const order: JobId[] = [];
  render(<Harness failing="rhetoric" order={order} />);
  fireEvent.click(screen.getByRole('button', { name: /Phân tích toàn bài · còn/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Chạy 7 phân tích' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Đã dừng ở “Validity và Moves”'), {
    timeout: 4000,
  });
  expect(order).toEqual(['digest', 'snapshot', 'measure', 'rhetoric']);
});

it('P3 cancelling the confirmation starts nothing', () => {
  const order: JobId[] = [];
  render(<Harness order={order} />);
  fireEvent.click(screen.getByRole('button', { name: /Phân tích toàn bài · còn/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(order).toEqual([]);
});

it('R6 includes stale completed analyses and shows their reason', async () => {
  const order: JobId[] = [];
  render(<Harness done={RUN_ALL} stale="rhetoric" order={order} />);
  fireEvent.click(screen.getByRole('button', { name: /Phân tích toàn bài · còn/ }));
  expect(screen.getByText('Kết quả cũ (model khác) · ~3 lượt gọi AI')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Chạy 1 phân tích' }));
  expect(await screen.findByText('Đã chạy xong 1 phân tích.')).toBeInTheDocument();
  expect(order).toEqual(['rhetoric']);
});

it('R15 whole-paper run shows what is left', () => {
  const order: JobId[] = [];
  const { unmount } = render(<Harness done={['snapshot']} order={order} />);
  expect(screen.getByRole('button', { name: 'Phân tích toàn bài · còn 6' })).toBeInTheDocument();
  unmount();
  render(<Harness done={RUN_ALL} order={order} />);
  expect(screen.queryByRole('button', { name: /Phân tích toàn bài · còn/ })).not.toBeInTheDocument();
});
