import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import Evaluate from '@/modules/evaluate/Page';
import Page from './Page';
import PaperMapPage from './PaperMapPage';
import type { LlmClient } from '@/shared/llm/client';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
function setup() {
  const repo = createRepositories(createDb(`paper-ui-${crypto.randomUUID()}`));
  render(
    <MemoryRouter initialEntries={['/papers']}>
      <StorageProvider repositories={repo}>
        <LlmProvider>
          <Routes>
            <Route path="/papers" element={<Page />} />
            <Route path="/papers/:id" element={<PaperMapPage />} />
            <Route path="/evaluate" element={<Evaluate />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  return repo;
}
function markdown() {
  const content = '# Introduction\n\nThe first paragraph.\n\n# Results\n\nA result.';
  const file = new File([content], 'study.md', { type: 'text/markdown' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(content).buffer });
  return file;
}
async function importPaper() {
  fireEvent.change(screen.getByLabelText('Chọn tệp bài báo'), { target: { files: [markdown()] } });
  fireEvent.click(await screen.findByRole('tab', { name: 'Đọc bài' }));
  await screen.findByText('The first paragraph.');
}
it('imports a paper, persists and audits role edits, then prefills Evaluate', async () => {
  const repo = setup();
  await importPaper();
  expect(await screen.findByText('0 ứng viên cục bộ')).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Phương pháp' })).toHaveAttribute('title', 'methods');
  fireEvent.change(screen.getByLabelText('Vai trò của mục'), { target: { value: 'methods' } });
  await waitFor(async () => expect((await repo.papers.list())[0]?.sections[0]?.role).toBe('methods'));
  const paper = (await repo.papers.list())[0];
  if (!paper) throw new Error('Paper missing');
  expect((await repo.audit.listByAnalysis(paper.id)).items.map((event) => event.action)).toContain(
    'edit_label',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Đánh giá đoạn này' }));
  expect(await screen.findByLabelText('Dán một đoạn văn tiếng Anh')).toHaveValue('The first paragraph.');
});
it('requires confirmation before deleting a paper', async () => {
  const repo = setup();
  await importPaper();
  fireEvent.click(screen.getByRole('tab', { name: 'D. Viết học thuật' }));
  fireEvent.click(screen.getByRole('link', { name: /Bài báo đã nhập/ }));
  await screen.findByRole('link', { name: 'study' });
  fireEvent.click(screen.getByRole('button', { name: 'Xoá' }));
  const dialog = screen.getByRole('alertdialog');
  expect(await repo.papers.list()).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xoá bài báo' }));
  await waitFor(async () => expect(await repo.papers.list()).toHaveLength(0));
  expect(await screen.findByText('Chưa có bài báo.')).toBeInTheDocument();
});
it('shows the size guard error before reading an oversized file', async () => {
  setup();
  const file = new File(['x'], 'large.md');
  Object.defineProperty(file, 'size', { value: 25 * 1024 * 1024 + 1 });
  fireEvent.change(screen.getByLabelText('Chọn tệp bài báo'), { target: { files: [file] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('25 MB');
});

it('P2 estimates selected calls, asks manuscript consent and opens a completed analysis', async () => {
  localStorage.clear();
  const repo = createRepositories(createDb(`batch-ui-${crypto.randomUUID()}`));
  const completeJson = vi.fn(async (options: Parameters<LlmClient['completeJson']>[0]) => ({
    data: options.schema.parse({ sentences: [] }),
    meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
  })) as LlmClient['completeJson'];
  render(
    <MemoryRouter initialEntries={['/papers']}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson }}>
          <Routes>
            <Route path="/papers" element={<Page />} />
            <Route path="/papers/:id" element={<PaperMapPage />} />
            <Route path="/evaluate" element={<Evaluate />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  await importPaper();
  fireEvent.click(screen.getByRole('tab', { name: 'D. Viết học thuật' }));
  expect(screen.getByText('Ước tính ~0 lượt gọi AI (giới hạn 150)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: /Introduction/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Phân tích câu' }));
  expect(screen.getByText('Ước tính ~1 lượt gọi AI (giới hạn 150)')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Giới hạn lượt gọi'), { target: { value: '0' } });
  expect(screen.getByText('Ước tính vượt giới hạn lượt gọi.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Giới hạn lượt gọi'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu phân tích' }));
  expect(await screen.findByText(/Các đoạn được chọn của bản thảo/)).toBeInTheDocument();
  expect(completeJson).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }));
  expect(await screen.findByText(/Tiến độ: 1\/1 đoạn/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Đọc bài' }));
  expect(await screen.findByText('Hoàn tất')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Mở trong Đánh giá' }));
  expect(await screen.findByRole('link', { name: 'Bài báo › Introduction' })).toBeInTheDocument();
});

it('P2 retries a failed paragraph and restores an interrupted run as paused', async () => {
  localStorage.clear();
  const repo = createRepositories(createDb(`batch-ui-${crypto.randomUUID()}`));
  let fail = true;
  const completeJson = vi.fn(async (options: Parameters<LlmClient['completeJson']>[0]) => {
    if (fail) throw Object.assign(new Error('HTTP 400'), { status: 400 });
    return {
      data: options.schema.parse({ sentences: [] }),
      meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
    };
  }) as LlmClient['completeJson'];
  const tree = (path: string) => (
    <MemoryRouter initialEntries={[path]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson }}>
          <Routes>
            <Route path="/papers" element={<Page />} />
            <Route path="/papers/:id" element={<PaperMapPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>
  );
  const view = render(tree('/papers'));
  await importPaper();
  fireEvent.click(screen.getByRole('tab', { name: 'D. Viết học thuật' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Introduction/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Phân tích câu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu phân tích' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Đồng ý và tiếp tục' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Đọc bài' }));
  expect(await screen.findByText('Thất bại')).toBeInTheDocument();
  expect(screen.getByText(/Đã có lỗi không xác định/)).toBeInTheDocument();
  fail = false;
  await waitFor(() => expect(screen.getByRole('button', { name: 'Thử lại' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText('Hoàn tất')).toBeInTheDocument();
  const paper = (await repo.papers.list())[0];
  if (!paper) throw new Error('missing paper');
  const run = (await repo.paperRuns.listByPaper(paper.id))[0];
  if (!run) throw new Error('missing run');
  await repo.paperRuns.save({ ...run, status: 'running' });
  view.unmount();
  render(tree(`/papers/${paper.id}`));
  fireEvent.click(await screen.findByRole('tab', { name: 'D. Viết học thuật' }));
  expect(await screen.findByRole('button', { name: 'Tiếp tục chạy' })).toBeInTheDocument();
  expect((await repo.paperRuns.get(run.id))?.status).toBe('paused');
});

it('P2 increases a budget on the same run when resuming', async () => {
  localStorage.clear();
  const repo = createRepositories(createDb(`batch-ui-${crypto.randomUUID()}`));
  const view = render(
    <MemoryRouter initialEntries={['/papers']}>
      <StorageProvider repositories={repo}>
        <LlmProvider>
          <Routes>
            <Route path="/papers" element={<Page />} />
            <Route path="/papers/:id" element={<PaperMapPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  await importPaper();
  fireEvent.click(screen.getByRole('tab', { name: 'D. Viết học thuật' }));
  const paper = (await repo.papers.list())[0];
  if (!paper) throw new Error('missing paper');
  const { planRun } = await import('@/core/batch');
  const plan = planRun(paper, { sectionIds: [paper.sections[0]?.id ?? ''], steps: ['syntax'], budget: 0 });
  const at = new Date().toISOString();
  const run = await repo.paperRuns.create({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    paperId: paper.id,
    createdAt: at,
    updatedAt: at,
    status: 'budget_exceeded',
    plan,
    budget: 0,
    callsUsed: 0,
    promptVersions: {},
    model: 'fake',
    items: plan.paragraphs.map((p) => ({
      paragraphId: p.paragraphId,
      textHash: p.textHash,
      analysisId: null,
      status: 'pending',
      stepsDone: [],
      calls: 0,
      error: null,
    })),
  });
  view.unmount();
  const client: LlmClient = {
    completeJson: async (options) => {
      await options.onRequest?.();
      throw new Error('fake failure');
    },
  };
  render(
    <MemoryRouter initialEntries={[`/papers/${paper.id}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={client}>
          <Routes>
            <Route path="/papers/:id" element={<PaperMapPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: 'D. Viết học thuật' }));
  // The field moves once the paused run has loaded, so wait for that before typing.
  const resume = await screen.findByRole('button', { name: 'Tiếp tục chạy' });
  fireEvent.change(screen.getByLabelText('Giới hạn lượt gọi'), { target: { value: '10' } });
  fireEvent.click(resume);
  expect(await screen.findByText(/Các đoạn được chọn của bản thảo/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }));
  await waitFor(async () => expect((await repo.paperRuns.get(run.id))?.budget).toBe(10), { timeout: 2000 });
  expect(await repo.paperRuns.listByPaper(paper.id)).toHaveLength(1);
});

it('P2 pauses after the current call and resumes the remaining step', async () => {
  localStorage.clear();
  const repo = createRepositories(createDb(`batch-ui-${crypto.randomUUID()}`));
  let release: (() => void) | undefined;
  const completeJson = vi.fn(async (options: Parameters<LlmClient['completeJson']>[0]) => {
    if (options.schemaName === 'sentence_syntax')
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return {
      data: options.schema.parse(
        options.schemaName === 'sentence_syntax' ? { sentences: [] } : { judgements: [], passive: [] },
      ),
      meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
    };
  }) as LlmClient['completeJson'];
  render(
    <MemoryRouter initialEntries={['/papers']}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson }}>
          <Routes>
            <Route path="/papers" element={<Page />} />
            <Route path="/papers/:id" element={<PaperMapPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  await importPaper();
  fireEvent.click(screen.getByRole('tab', { name: 'D. Viết học thuật' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Introduction/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Phân tích câu' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Đánh giá ngữ cảnh' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu phân tích' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Đồng ý và tiếp tục' }));
  await waitFor(() => expect(release).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: 'Tạm dừng' }));
  release?.();
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục chạy' }));
  await waitFor(() => expect(completeJson).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('tab', { name: 'Đọc bài' }));
  expect(await screen.findByText('Hoàn tất')).toBeInTheDocument();
});
