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

it('R5 P4 runs local checks, navigates to evidence, reviews and shows overview counts', async () => {
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
  // Figures & tables is a check about writing: it lives in the Writing style space, and runs on open.
  const openChecks = () => {
    const entry = screen.queryAllByRole('button', { name: /^Writing style/ })[0];
    if (entry) fireEvent.click(entry);
    const fold = screen.queryByRole('button', { name: 'Mở Automated checks' });
    if (fold) fireEvent.click(fold);
    fireEvent.click(screen.getByRole('radio', { name: 'Figures & tables' }));
  };
  await screen.findByRole('tab', { name: 'Full text' });
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
  // Inside a space the passage opens in the drawer, and from there in the reader.
  expect(screen.getByText('Figure 2', { selector: 'mark' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mở trong Đọc bài' }));
  expect(screen.getByRole('tab', { name: 'Full text' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Figure 2', { selector: 'mark' })).toBeInTheDocument();
  expect(scroll).toHaveBeenCalled();
  openChecks();
  const cardAgain =
    screen.getByRole('heading', { name: 'Hình và bảng' }).closest('section') ??
    screen.getByRole('heading', { name: 'Hình và bảng' }).parentElement;
  if (!cardAgain) throw new Error('Missing card');
  // A check's finding counts as accepted: the only decision is to reject it, and it can be undone.
  expect(within(cardAgain).queryByRole('button', { name: 'Xác nhận' })).toBeNull();
  fireEvent.click(within(cardAgain).getByRole('button', { name: 'Bác bỏ' }));
  const dismissed = await within(cardAgain).findByText('Đã bác bỏ (1)');
  expect(dismissed.parentElement).not.toHaveAttribute('open');
  fireEvent.click(dismissed);
  fireEvent.click(within(cardAgain).getByRole('button', { name: 'Hoàn tác' }));
  await waitFor(async () =>
    expect(
      (await repo.audit.listByAnalysis(paper.id)).items.filter((e) => e.action === 'review_check'),
    ).toHaveLength(2),
  );
  // Each space opens on the profile's dimensions it is about: discourse and writing in Writing style,
  // where the reader already is.
  const writing = screen.getByRole('region', { name: 'Writing overview' });
  expect(await within(writing).findByText('Hình và bảng cần kiểm tra')).toBeInTheDocument();
  expect(
    within(writing)
      .getAllByRole('article')
      .map((card) => card.getAttribute('aria-label')),
  ).toEqual(['Diễn ngôn và Tu từ', 'Viết học thuật']);
  fireEvent.click(screen.getByRole('button', { name: '← Quay lại bài' }));
  // The scholarly context leads the Citations tab.
  fireEvent.click(screen.getByRole('tab', { name: 'Citations' }));
  const context = await within(screen.getByRole('region', { name: 'Context overview' })).findByRole(
    'article',
    { name: 'Bối cảnh học thuật và Nguồn gốc' },
  );
  fireEvent.click(within(context).getByRole('button', { name: 'Xem chi tiết' }));
  // References live in the Citations tab: the card opens that block there, already unfolded.
  expect(screen.getByRole('tab', { name: 'Citations' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: 'Thu gọn References' })).toHaveAttribute('aria-expanded', 'true');
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

it('R7 on a wide screen the paper is the centre column beside the analysis, and a finding is marked there', async () => {
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
  const pane = await screen.findByRole('region', { name: 'Paper' });
  expect(within(pane).getByText('An introduction.')).toBeInTheDocument();
  // Two columns, each with its own tabs: the paper in the centre, the analysis on the right.
  expect(
    within(screen.getByRole('tablist', { name: 'Paper' }))
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual(['Full text', 'Summary']);
  expect(
    within(screen.getByRole('tablist', { name: 'Analysis' }))
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual(['Issues', 'Citations', 'Paper info']);
  fireEvent.click(screen.getByRole('button', { name: /^Writing style/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Coherence & sentences' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Paragraph structure & flow' }));
  // A space takes the whole width; going back shows the paper beside the right column again.
  expect(document.querySelector('section[aria-label="Paper"]')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '← Quay lại bài' }));
  expect(screen.getByRole('region', { name: 'Paper' })).toBeVisible();
  // The rule checks ran when the paper opened: their finding is in the Issues list beside the paper.
  fireEvent.click(screen.getByRole('tab', { name: 'Issues' }));
  const list = await screen.findByRole('region', { name: 'Issues' });
  const quote = await within(list).findByText('“Figure 2”');
  const card = quote.closest('article');
  if (!(card instanceof HTMLElement)) throw new Error('Missing card');
  fireEvent.click(within(card).getByRole('button', { name: /Results/ }));
  // The finding is marked in the paper beside it: no drawer, and the analysis tab stays open.
  expect(within(pane).getByText('Figure 2', { selector: 'mark' })).toBeInTheDocument();
  expect(within(pane).getByRole('heading', { name: 'Results' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('tab', { name: 'Issues' })).toHaveAttribute('aria-selected', 'true');

  // R2: the same finding heads a card in the one list, without labels that add nothing to read.
  expect(within(list).getByText('Không tìm thấy chú thích tương ứng.')).toBeInTheDocument();
  expect(within(list).queryByText('Rule')).toBeNull();
  expect(within(list).queryByText(/^(High|Medium|Low)$/)).toBeNull();
  // R2: it is drawn on the words of the paper, as a control and not by colour alone.
  const underlined = within(pane).getByRole('button', { name: 'Figure 2' });
  expect(underlined).toHaveAttribute('data-finding', 'true');
  expect(underlined.getAttribute('title')).toContain('Evidence');
  fireEvent.click(underlined);
  expect(list.querySelector('[data-focus="true"]')).not.toBeNull();
  // Accepted by default: the list offers only to reject it.
  expect(within(list).queryByRole('button', { name: 'Xác nhận' })).toBeNull();
  expect(within(list).getByRole('button', { name: 'Bác bỏ' })).toBeInTheDocument();
  // A layer can be switched off; the passage the reader opened stays marked.
  const layer = within(pane).getByRole('button', { name: /Evidence/ });
  expect(layer).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(layer);
  expect(within(pane).queryByRole('button', { name: 'Figure 2' })).toBeNull();
  expect(within(pane).getByText('Figure 2', { selector: 'mark' })).toBeInTheDocument();

  // The issues needing review are announced in the header and counted on the tab.
  expect(screen.queryByRole('button', { name: /cần duyệt$/ })).toBeNull();
  // Hiding the analysis leaves the paper alone on the page and remembers the choice.
  fireEvent.click(screen.getByRole('button', { name: 'Ẩn phân tích' }));
  expect(screen.queryByRole('region', { name: 'Analysis' })).toBeNull();
  expect(screen.getByRole('region', { name: 'Paper' })).toBeVisible();
  expect(localStorage.getItem('paper-split')).toBe('false');
  localStorage.removeItem('paper-split');
  vi.unstubAllGlobals();
});
