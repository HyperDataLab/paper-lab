import 'fake-indexeddb/auto';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PaperMapPage from './PaperMapPage';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const pick = (name: RegExp) => fireEvent.click(screen.getByRole('treeitem', { name }));
const expand = (name: RegExp) =>
  fireEvent.keyDown(screen.getByRole('treeitem', { name }), { key: 'ArrowRight' });

it('M4 shows an overview with counts and no overall score', async () => {
  await setup();
  expect(await screen.findByText('Thực nghiệm')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /1\s*metric/ })).toBeInTheDocument();
  expect(screen.getByText(/không có điểm tổng/)).toBeInTheDocument();
  expect(screen.getByRole('table')).toHaveTextContent('Seed ngẫu nhiên');
});

it('AC-03 FR-14 shows who said what, and folds fields the paper does not give', async () => {
  await setup();
  await screen.findByText('Thực nghiệm');
  expand(/Thí nghiệm/);
  pick(/Main/);
  expect(screen.getByText(/Không có thông tin \(9\):.*Seed ngẫu nhiên/)).toBeInTheDocument();
  expand(/Cảnh báo của AI/);
  pick(/Chưa thấy nêu seed/);
  expect(screen.getByText('AI lưu ý')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Protocol chưa đủ' })).toBeInTheDocument();
  expand(/Claim của tác giả/);
  pick(/Robust under dropout/);
  expect(screen.getAllByText('Tác giả nêu').length).toBeGreaterThan(0);
  expect(screen.getByText(/Chỉ trong kịch bản đã đo/)).toBeInTheDocument();
});

it('M4 walks the tree from experiment through metric to result', async () => {
  await setup();
  await screen.findByText('Thực nghiệm');
  expand(/Thí nghiệm/);
  expand(/Main/);
  pick(/Accuracy/);
  expect(screen.getByRole('heading', { name: 'Accuracy' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Baseline' }));
  expect(screen.getByText('0.123 ± 0.004 %')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Thí nghiệm: Main/ }));
  expect(screen.getByRole('heading', { name: 'Main' })).toBeInTheDocument();
});

it('M4 filters the tree by search', async () => {
  await setup();
  await screen.findByText('Thực nghiệm');
  fireEvent.change(screen.getByLabelText('Tìm trong hồ sơ'), { target: { value: 'baseline' } });
  expect(screen.getAllByRole('treeitem')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Tìm trong hồ sơ'), { target: { value: 'zzz' } });
  expect(screen.getByText('Không có mục nào khớp.')).toBeInTheDocument();
});

it('AC-05 AC-08 shows the exact value and opens its source with the page', async () => {
  const { onLocation } = await setup();
  await screen.findByText('Thực nghiệm');
  expand(/Thí nghiệm/);
  pick(/Main/);
  expect(screen.getByRole('cell', { name: '0.123' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '0.004' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tr. 3 · hàng 2, cột 2' }));
  expect(onLocation).toHaveBeenCalledWith({ paragraphId: 't1', start: 28, end: 41 });
});

it('AC-07 edits a field in the metric detail and keeps the original', async () => {
  const { repo, run } = await setup();
  await screen.findByText('Thực nghiệm');
  expand(/Thí nghiệm/);
  expand(/Main/);
  pick(/Accuracy/);
  fireEvent.click(screen.getAllByRole('button', { name: 'Sửa' })[0] as HTMLElement);
  fireEvent.change(screen.getByLabelText('Sửa: Định nghĩa'), { target: { value: 'Định nghĩa đã sửa' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  expect(await screen.findByText('Định nghĩa đã sửa')).toBeInTheDocument();
  expect(screen.getByText('Đã sửa')).toBeInTheDocument();
  expect(screen.getByText('Người duyệt sửa')).toBeInTheDocument();
  const record = await repo.measurements.get(PAPER_ID);
  expect(record?.runs.find((item) => item.id === run.id)?.profile).toEqual(run.profile);
  expect(record?.decisions).toHaveLength(1);
});

it('FR-15 rejects and undoes an item', async () => {
  await setup();
  await screen.findByText('Thực nghiệm');
  expand(/Cảnh báo của AI/);
  pick(/Chưa thấy nêu seed/);
  fireEvent.click(screen.getByRole('button', { name: 'Loại bỏ' }));
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
  expect(await screen.findByText(/ước tính 5 lượt gọi/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu phân tích' }));
  expect(await screen.findByText('Nghiên cứu trường hợp')).toBeInTheDocument();
  expect(completeJson).toHaveBeenCalledTimes(5);
});

it('FR-01 saves the call count before a classification request fails', async () => {
  acceptConsent(getConfig(), true);
  const completeJson = vi.fn(async (options: { onRequest: () => Promise<void> }) => {
    await options.onRequest();
    expect((await context.repo.measurements.get(PAPER_ID))?.pending).toMatchObject({
      callsUsed: 1,
      checkpoint: { classification: null },
    });
    throw new Error('synthetic failure');
  });
  const context = await setup(false, { completeJson } as unknown as LlmClient);
  fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu phân tích' }));
  expect(await screen.findByRole('button', { name: /Tiếp tục phần còn lại/ })).toBeInTheDocument();
  expect(completeJson).toHaveBeenCalledTimes(1);
});

it('FR-01 offers resume when linking fails after extraction', async () => {
  acceptConsent(getConfig(), true);
  const replies: Record<string, unknown> = {
    measurement_classification: { paper_type: 'EMPIRICAL', rationale: 'r', quotes: [] },
    measurement_extraction: {
      constructs: [],
      metrics: [],
      experiments: [],
      results: [],
      claims: [],
      taxonomy: [],
      review_method: null,
    },
    measurement_findings: { findings: [] },
  };
  const completeJson = vi.fn(async (options: { schemaName: string; onRequest: () => Promise<void> }) => {
    await options.onRequest();
    if (options.schemaName === 'measurement_links') throw new Error('synthetic failure');
    return {
      data: replies[options.schemaName],
      meta: { model: 'm', promptVersion: 'p', latencyMs: 1, repaired: false },
    };
  });
  const { repo } = await setup(false, { completeJson } as unknown as LlmClient);
  fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu phân tích' }));
  expect(await screen.findByRole('button', { name: /Tiếp tục phần còn lại/ })).toBeInTheDocument();
  expect((await repo.measurements.get(PAPER_ID))?.runs[0]?.profile.steps.link).toBe('failed');
});

it('FR-16 offers the four exports and downloads the reviewed profile', async () => {
  const create = vi.fn((_blob: Blob) => 'blob:x');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await setup();
  await screen.findByText('Thực nghiệm');
  for (const name of ['JSON', 'Markdown', 'CSV metric', 'CSV protocol']) {
    fireEvent.click(screen.getByRole('button', { name: 'Xuất' }));
    fireEvent.click(screen.getByRole('menuitem', { name }));
  }
  expect(click).toHaveBeenCalledTimes(4);
  expect(await create.mock.calls[2]?.[0].text()).toContain('reported_name');
  click.mockRestore();
});

it('AS-10 opens an atomic sentence, marks it checked, undoes it and tracks progress', async () => {
  const repo: Repositories = createRepositories(createDb(`measure-ui-${crypto.randomUUID()}`));
  await repo.papers.create(fixturePaper);
  const run = fixtureRun();
  run.profile.atomic_sentences = [
    {
      id: 'as-0001',
      text: 'Accuracy is the share of correct predictions.',
      role: 'method',
      word_count: 7,
      evidence_id: run.profile.evidence[0]?.id ?? '',
      page: 3,
      section_id: 'met',
      needs_review: false,
      human_checked: false,
    },
  ];
  run.profile.claims[0]!.atomic_ids = ['as-0001'];
  await repo.measurements.saveRun(PAPER_ID, run);
  render(
    <StorageProvider repositories={repo}>
      <LlmProvider>
        <PaperMeasurement paper={fixturePaper} onLocation={vi.fn()} />
      </LlmProvider>
    </StorageProvider>,
  );
  await screen.findByText('Thực nghiệm');
  fireEvent.click(screen.getByRole('button', { name: /1\s*câu nguyên tử/ }));
  expect(screen.getByText('Đã đối chiếu 0/1')).toBeInTheDocument();
  expand(/Câu nguyên tử/);
  expand(/Phương pháp/);
  pick(/Accuracy is the share/);
  expect(screen.getByText('7 từ')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Đã đối chiếu với nguồn' }));
  expect(await screen.findByText('Đã đối chiếu')).toBeInTheDocument();
  pick(/Câu nguyên tử/);
  expect(await screen.findByText('Đã đối chiếu 1/1')).toBeInTheDocument();
  pick(/Accuracy is the share/);
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
  expect(await screen.findByRole('button', { name: 'Đã đối chiếu với nguồn' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Claim: Robust/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Câu nguyên tử 1' }));
  expect(screen.getByText('7 từ')).toBeInTheDocument();
});

it('R5 decides a measurement finding from the unified list', async () => {
  const repo = createRepositories(createDb(`r5-measure-${crypto.randomUUID()}`));
  await repo.papers.create(fixturePaper);
  const run = fixtureRun();
  await repo.measurements.saveRun(PAPER_ID, run);
  render(
    <MemoryRouter initialEntries={[`/papers/${PAPER_ID}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider>
          <Routes>
            <Route path="/papers/:id" element={<PaperMapPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: 'Issues' }));
  const list = await screen.findByRole('region', { name: 'Issues' });
  const finding = await within(list).findByText('Chưa thấy nêu seed.');
  const row = finding.closest('[id^="finding-measurement:"]');
  if (!(row instanceof HTMLElement)) throw new Error('Missing measurement finding');
  fireEvent.click(within(row).getByRole('button', { name: 'Xác nhận' }));
  await within(row).findByText('Đã xác nhận');
  expect((await repo.measurements.get(PAPER_ID))?.decisions.at(-1)).toMatchObject({
    run_id: run.id,
    decision: 'accept',
  });
});
