import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fixturePaper, fixtureRun, PAPER_ID } from '@/core/measurement/testFixture';
import { acceptConsent } from '@/shared/llm/consent';
import { getConfig } from '@/shared/llm/config';
import type { LlmClient } from '@/shared/llm/client';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories, type Repositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { PaperMeasurement } from './PaperMeasurement';

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
});
async function setup(seed = true, client?: LlmClient) {
  const repo: Repositories = createRepositories(createDb(`measure-ui-${crypto.randomUUID()}`));
  await repo.papers.create(fixturePaper);
  const run = fixtureRun();
  if (seed) await repo.measurements.saveRun(PAPER_ID, run);
  const onLocation = vi.fn();
  render(
    <StorageProvider repositories={repo}>
      <LlmProvider innerClient={client}>
        <PaperMeasurement paper={fixturePaper} onLocation={onLocation} />
      </LlmProvider>
    </StorageProvider>,
  );
  return { repo, run, onLocation };
}
const open = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));

it('M4 shows an overview with counts and no overall score', async () => {
  await setup();
  expect(await screen.findByText('Thực nghiệm')).toBeInTheDocument();
  expect(screen.getByText('1 metric')).toBeInTheDocument();
  expect(screen.getByText('1 kết quả')).toBeInTheDocument();
  expect(screen.getByText(/không có điểm tổng/)).toBeInTheDocument();
});

it('AC-03 FR-14 shows who said what, and missing seeds as not found', async () => {
  await setup();
  await screen.findByText('Thực nghiệm');
  open('Protocol');
  expect(screen.getByText('Seed ngẫu nhiên')).toBeInTheDocument();
  expect(screen.getAllByText('Không thấy trong phần đã phân tích')).toHaveLength(9);
  open('Vấn đề & duyệt');
  expect(screen.getByText('AI lưu ý')).toBeInTheDocument();
  expect(screen.getByText('Protocol chưa đủ')).toBeInTheDocument();
  open('Kết quả & truy vết');
  expect(screen.getAllByText('Tác giả nêu').length).toBeGreaterThan(0);
  expect(screen.getByText(/Chỉ trong kịch bản đã đo/)).toBeInTheDocument();
});

it('AC-05 AC-08 shows the exact value and opens its source with the page', async () => {
  const { onLocation } = await setup();
  await screen.findByText('Thực nghiệm');
  open('Kết quả & truy vết');
  expect(screen.getByRole('cell', { name: '0.123' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '0.004' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tr. 3 · hàng 2, cột 2' }));
  expect(onLocation).toHaveBeenCalledWith({ paragraphId: 't1', start: 28, end: 41 });
});

it('AC-07 edits a field in the metric detail and keeps the original', async () => {
  const { repo, run } = await setup();
  await screen.findByText('Thực nghiệm');
  open('Metric');
  fireEvent.click(screen.getByRole('button', { name: 'Chi tiết' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Sửa' })[0] as HTMLElement);
  fireEvent.change(screen.getByLabelText('Sửa: Định nghĩa'), { target: { value: 'Định nghĩa đã sửa' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  expect(await screen.findByText('Định nghĩa đã sửa')).toBeInTheDocument();
  expect(screen.getByText('Đã sửa')).toBeInTheDocument();
  const record = await repo.measurements.get(PAPER_ID);
  expect(record?.runs.find((item) => item.id === run.id)?.profile).toEqual(run.profile);
  expect(record?.decisions).toHaveLength(1);
});

it('FR-15 rejects and undoes an item', async () => {
  await setup();
  await screen.findByText('Thực nghiệm');
  open('Vấn đề & duyệt');
  fireEvent.click(screen.getByRole('button', { name: 'Loại' }));
  expect(await screen.findByText('Đã loại')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
  await waitFor(() => expect(screen.queryByText('Đã loại')).toBeNull());
});

it('FR-01 runs an analysis with an estimate and budget', async () => {
  acceptConsent(getConfig(), true);
  const empty = {
    constructs: [],
    metrics: [],
    experiments: [],
    results: [],
    claims: [],
    taxonomy: [],
    review_method: null,
  };
  const replies: Record<string, unknown> = {
    measurement_classification: { paper_type: 'CASE_STUDY', rationale: 'r', quotes: [] },
    measurement_extraction: empty,
    measurement_links: { metric_merges: [], result_links: [], metric_experiments: [], claim_links: [] },
    measurement_findings: { findings: [] },
  };
  const completeJson = vi.fn(async (options: { schemaName: string; onRequest?: () => Promise<void> }) => {
    await options.onRequest?.();
    return {
      data: replies[options.schemaName],
      meta: { model: 'm', promptVersion: 'p', latencyMs: 1, repaired: false },
    };
  });
  await setup(false, { completeJson } as unknown as LlmClient);
  expect(await screen.findByText(/Ước tính 5 lượt gọi/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu phân tích' }));
  expect(await screen.findByText('Nghiên cứu trường hợp')).toBeInTheDocument();
  expect(completeJson).toHaveBeenCalledTimes(5);
});
