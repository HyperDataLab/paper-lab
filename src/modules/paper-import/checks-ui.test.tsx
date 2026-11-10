import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import type { Paper } from '@/core/schemas';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import PaperMapPage from './PaperMapPage';

it('P4 runs local checks, navigates to evidence, reviews and shows overview counts', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const scroll = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  const repo = createRepositories(createDb(`p4-ui-${crypto.randomUUID()}`));
  const at = '2026-01-01T00:00:00.000Z';
  const paper: Paper = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: 'Bài kiểm tra',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
    sections: [
      { id: 'a', heading: 'Introduction', role: 'introduction', level: 1, pageStart: null },
      { id: 'b', heading: 'Results', role: 'results', level: 1, pageStart: null },
    ],
    paragraphs: [
      {
        id: 'p1',
        sectionId: 'a',
        order: 0,
        kind: 'body',
        text: 'An introduction.',
        pageStart: null,
        textHash: '',
      },
      {
        id: 'p2',
        sectionId: 'b',
        order: 1,
        kind: 'body',
        text: '😀 See Figure 2.',
        pageStart: null,
        textHash: '',
      },
    ],
  };
  await repo.papers.create(paper);
  const completeJson = vi.fn(async () => {
    throw new Error('Unexpected model call');
  });
  render(
    <MemoryRouter initialEntries={[`/papers/${paper.id}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson }}>
          <Routes>
            <Route path="/papers/:id" element={<PaperMapPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  const openChecks = () => {
    fireEvent.click(screen.getByRole('tab', { name: 'Hồ sơ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chất lượng viết' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Cấu trúc và mạch' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Phát hiện' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Hình và bảng' }));
  };
  await screen.findByRole('tab', { name: 'Đọc bài' });
  expect(screen.getByText('Minh bạch')).toBeInTheDocument();
  openChecks();
  expect(screen.getByText(/Các kiểm tra tự động là thử nghiệm/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Chạy kiểm tra' }));
  const heading = await screen.findByRole('heading', { name: 'Hình và bảng' });
  const card = heading.closest('section') ?? heading.parentElement;
  if (!card) throw new Error('Missing card');
  expect(within(card).getByText('Cảnh báo')).toBeInTheDocument();
  expect(screen.getAllByText(/Chưa hiệu chuẩn/)).toHaveLength(1);
  expect(screen.getByLabelText('Ẩn mục chưa đáng tin')).not.toBeChecked();
  expect(screen.getByText(/Lần chạy gần nhất/)).toBeInTheDocument();
  fireEvent.click(
    within(card).getByText('“Figure 2”').closest('article')?.querySelector('button') as HTMLElement,
  );
  expect(screen.getByRole('tab', { name: 'Phát hiện' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Figure 2', { selector: 'mark' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mở trong Đọc bài' }));
  expect(screen.getByRole('tab', { name: 'Đọc bài' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Figure 2', { selector: 'mark' })).toBeInTheDocument();
  expect(scroll).toHaveBeenCalled();
  openChecks();
  const cardAgain =
    screen.getByRole('heading', { name: 'Hình và bảng' }).closest('section') ??
    screen.getByRole('heading', { name: 'Hình và bảng' }).parentElement;
  if (!cardAgain) throw new Error('Missing card');
  fireEvent.click(within(cardAgain).getByRole('button', { name: 'Xác nhận' }));
  await within(cardAgain).findByText('Đã xác nhận');
  expect(await within(cardAgain).findByText('Chưa hiệu chuẩn (n=1)')).toBeInTheDocument();
  fireEvent.click(within(cardAgain).getByRole('button', { name: 'Hoàn tác' }));
  fireEvent.click(await within(cardAgain).findByRole('button', { name: 'Bỏ qua' }));
  const dismissed = await within(cardAgain).findByText('Đã bỏ qua (1)');
  expect(dismissed.parentElement).not.toHaveAttribute('open');
  fireEvent.click(dismissed);
  fireEvent.click(within(cardAgain).getByRole('button', { name: 'Hoàn tác' }));
  await waitFor(async () =>
    expect(
      (await repo.audit.listByAnalysis(paper.id)).items.filter((e) => e.action === 'review_check'),
    ).toHaveLength(4),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Tóm lược' }));
  expect(await screen.findByText('Hình và bảng cần kiểm tra')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Hồ sơ' })).toBeEnabled();
  const context = screen.getByRole('article', { name: 'Bối cảnh học thuật và Nguồn gốc' });
  fireEvent.click(within(context).getByRole('button', { name: 'Xem chi tiết' }));
  // The card opens its block in Hồ sơ, already unfolded.
  expect(screen.getByRole('tab', { name: 'Hồ sơ' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: 'Thu gọn Tài liệu tham khảo' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(await screen.findByRole('heading', { name: 'Tình trạng rút bài' })).toBeInTheDocument();
  expect(completeJson).not.toHaveBeenCalled();
});

it('a link from a grounded citation opens the reader on the quoted passage', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const scroll = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  const repo = createRepositories(createDb(`grounding-link-${crypto.randomUUID()}`));
  const at = '2026-01-01T00:00:00.000Z';
  const paper: Paper = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: 'Bài có trích dẫn',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
    sections: [
      { id: 'a', heading: 'Introduction', role: 'introduction', level: 1, pageStart: null },
      { id: 'b', heading: 'Results', role: 'results', level: 1, pageStart: null },
    ],
    paragraphs: [
      {
        id: 'p1',
        sectionId: 'a',
        order: 0,
        kind: 'body',
        text: 'An introduction.',
        pageStart: null,
        textHash: '',
      },
      {
        id: 'p2',
        sectionId: 'b',
        order: 1,
        kind: 'body',
        text: 'Latency fell to 10 ms.',
        pageStart: null,
        textHash: '',
      },
    ],
  };
  await repo.papers.create(paper);
  render(
    <MemoryRouter initialEntries={[`/papers/${paper.id}?p=p2&s=16&e=21`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson: vi.fn() }}>
          <Routes>
            <Route path="/papers/:id" element={<PaperMapPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  const mark = await screen.findByText('10 ms', { selector: 'mark' });
  expect(mark.closest('#paper-paragraph-p2')).not.toBeNull();
  await waitFor(() => expect(scroll).toHaveBeenCalled());
});

it('on a wide screen the paper stays beside the analysis and a finding is marked there', async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  localStorage.removeItem('paper-split');
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  const repo = createRepositories(createDb(`split-${crypto.randomUUID()}`));
  const at = '2026-01-01T00:00:00.000Z';
  const paper: Paper = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: 'Bài song song',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
    sections: [
      { id: 'a', heading: 'Introduction', role: 'introduction', level: 1, pageStart: null },
      { id: 'b', heading: 'Results', role: 'results', level: 1, pageStart: null },
    ],
    paragraphs: [
      {
        id: 'p1',
        sectionId: 'a',
        order: 0,
        kind: 'body',
        text: 'An introduction.',
        pageStart: null,
        textHash: '',
      },
      {
        id: 'p2',
        sectionId: 'b',
        order: 1,
        kind: 'body',
        text: 'See Figure 2.',
        pageStart: null,
        textHash: '',
      },
    ],
  };
  await repo.papers.create(paper);
  render(
    <MemoryRouter initialEntries={[`/papers/${paper.id}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson: vi.fn() }}>
          <Routes>
            <Route path="/papers/:id" element={<PaperMapPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  const pane = await screen.findByRole('complementary', { name: 'Bài báo' });
  expect(within(pane).getByText('An introduction.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Hồ sơ' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chất lượng viết' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Cấu trúc và mạch' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Phát hiện' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Hình và bảng' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chạy kiểm tra' }));
  const quote = await screen.findByText('“Figure 2”');
  fireEvent.click(quote.closest('article')?.querySelector('button') as HTMLElement);
  // The finding is marked in the paper beside it: no drawer, and the analysis tab stays open.
  expect(within(pane).getByText('Figure 2', { selector: 'mark' })).toBeInTheDocument();
  expect(within(pane).getByLabelText('Mục đang đọc')).toHaveValue('b');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('tab', { name: 'Phát hiện' })).toHaveAttribute('aria-selected', 'true');

  // Turning it off brings back the single-column page and remembers the choice.
  fireEvent.click(screen.getByRole('button', { name: 'Đọc song song' }));
  expect(screen.queryByRole('complementary', { name: 'Bài báo' })).toBeNull();
  expect(localStorage.getItem('paper-split')).toBe('false');
  localStorage.removeItem('paper-split');
  vi.unstubAllGlobals();
});
