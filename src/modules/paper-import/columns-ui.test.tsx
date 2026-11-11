import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runPaperChecks } from '@/core/paperChecks';
import type { PaperFinding } from '@/core/paperFindings';
import type { Paper } from '@/core/schemas';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { FindingsList } from './FindingsList';
import PaperMapPage from './PaperMapPage';

const at = '2026-01-01T00:00:00.000Z';
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-0000000000c7',
  title: 'Two columns',
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

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

it('R15 the page switch keeps every space reachable and the split label follows its state', async () => {
  const repo = createRepositories(createDb(`columns-${crypto.randomUUID()}`));
  await repo.papers.create(paper);
  await repo.paperChecks.save({
    schemaVersion: 1,
    paperId: paper.id,
    report: runPaperChecks(paper),
    decisions: [],
  });
  render(
    <MemoryRouter initialEntries={[`/papers/${paper.id}?view=toulmin`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson: vi.fn() }}>
          <Routes>
            <Route path="/papers/:id" element={<PaperMapPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  // A Toulmin link opens the Arguments space, full width, with a way back to the paper.
  const spaces = await screen.findByRole('tablist', { name: 'Spaces' });
  expect(within(spaces).getByRole('tab', { name: /^Arguments/ })).toHaveAttribute('aria-selected', 'true');
  expect(document.querySelector('section[aria-label="Paper"]')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '← Quay lại bài' }));
  const centre = await screen.findByRole('tablist', { name: 'Paper' });
  expect(within(centre).getByRole('tab', { name: 'Full text' })).toHaveAttribute('aria-selected', 'true');
  const right = screen.getByRole('tablist', { name: 'Analysis' });
  expect(
    within(right)
      .getAllByRole('tab')
      .map((tab) => tab.textContent?.replace(/\d+$/, '')),
  ).toEqual(['Issues', 'Citations']);
  expect(within(spaces).getByRole('tab', { name: /^Writing style/ })).toBeInTheDocument();
  expect(within(spaces).getByRole('tab', { name: 'Data table' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ẩn phân tích' }));
  expect(screen.getByRole('button', { name: 'Hiện phân tích' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Hiện phân tích' }));
  // Results are accepted by default, so nothing announces a queue to review.
  fireEvent.click(within(right).getByRole('tab', { name: 'Issues' }));
  expect(within(right).getByRole('tab', { name: 'Issues' })).toHaveTextContent(/^Issues$/);
  const issues = await screen.findByRole('region', { name: 'Issues' });
  expect(within(issues).getByRole('button', { name: 'Bác bỏ' })).toBeInTheDocument();
  expect(screen.queryByText(/cần duyệt/)).toBeNull();
  // No help line under the tabs, and the list has only the criterion filter.
  expect(screen.queryByText(/Mọi phát hiện về bài ở một chỗ/)).toBeNull();
  expect(within(issues).queryByRole('group', { name: 'Filter by status' })).toBeNull();
  expect(within(issues).queryByText('Sections × criteria')).toBeNull();
});

it('R15 Theo trang sorts findings by their source page', () => {
  const locatedPaper = { ...paper, paragraphs: paper.paragraphs.map((p, i) => ({ ...p, pageStart: i + 1 })) };
  const finding = (id: string, paragraphId: string): PaperFinding => ({
    id,
    source: 'checks',
    criterion: 'claim',
    title: id,
    code: null,
    reason: null,
    locations: [{ paragraphId, start: 0, end: 1 }],
    sectionId: null,
    severity: 'low',
    origin: 'rule',
    status: 'open',
    view: 'science-checks',
  });
  render(
    <FindingsList
      paper={locatedPaper}
      findings={[finding('Second', 'p2'), finding('First', 'p1')]}
      focusId={null}
      onLocation={vi.fn()}
      onOpenSource={vi.fn()}
      onDecide={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Theo trang' }));
  expect(
    [...screen.getByRole('region', { name: 'Issues' }).querySelectorAll('article strong')].map(
      (node) => node.textContent,
    ),
  ).toEqual(['First', 'Second']);
});

it('R15 checks are a filter inside Issues', () => {
  const run = vi.fn();
  render(
    <FindingsList
      paper={paper}
      findings={[]}
      focusId={null}
      onLocation={vi.fn()}
      onOpenSource={vi.fn()}
      onDecide={vi.fn()}
      onRunChecks={run}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra tự động' }));
  expect(screen.getByRole('button', { name: 'Kiểm tra tự động' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Chạy lại kiểm tra' }));
  expect(run).toHaveBeenCalledOnce();
});

it('R7 issues are grouped by type of problem, the most severe first, with rejections counted', () => {
  const finding = (
    id: string,
    criterion: PaperFinding['criterion'],
    severity: PaperFinding['severity'],
    status: PaperFinding['status'],
  ): PaperFinding => ({
    id,
    source: 'checks',
    criterion,
    title: id,
    code: null,
    reason: null,
    locations: [],
    sectionId: null,
    severity,
    origin: 'rule',
    status,
    view: 'science-checks',
  });
  render(
    <FindingsList
      paper={paper}
      findings={[
        finding('writing low', 'writing', 'low', 'open'),
        finding('evidence low', 'evidence', 'low', 'dismissed'),
        finding('claim confirmed high', 'claim', 'high', 'confirmed'),
        finding('evidence high', 'evidence', 'high', 'open'),
        finding('claim low', 'claim', 'low', 'open'),
        finding('source medium', 'context', 'medium', 'open'),
      ]}
      focusId={null}
      onLocation={vi.fn()}
      onOpenSource={vi.fn()}
      onDecide={vi.fn()}
    />,
  );
  // Writing starts switched off when there is anything else; switch it on to see every group.
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Filter by criterion' })).getByRole('button', {
      name: /Writing/,
    }),
  );
  const list = screen.getByRole('region', { name: 'Issues' });
  expect([...list.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual([
    'C Claims & reasoning 2',
    'E Evidence & data 1 · 1 đã bác bỏ',
    'S Sources & citations 1',
    'W Writing 1',
  ]);
  expect([...list.querySelectorAll('article strong')].map((title) => title.textContent)).toEqual([
    'claim confirmed high',
    'claim low',
    'evidence high',
    'evidence low',
    'source medium',
    'writing low',
  ]);
  // A rejected card stays in place, marked, with undo.
  const rejected = list.querySelector('[id="finding-evidence low"]');
  if (!(rejected instanceof HTMLElement)) throw new Error('Missing rejected card');
  expect(within(rejected).getByText('Đã bác bỏ')).toBeInTheDocument();
  expect(within(rejected).getByRole('button', { name: 'Hoàn tác' })).toBeInTheDocument();
});

it('R11 each space lists the issues of its own criteria, accepted until rejected', async () => {
  const repo = createRepositories(createDb(`columns-${crypto.randomUUID()}`));
  await repo.papers.create(paper);
  await repo.paperChecks.save({
    schemaVersion: 1,
    paperId: paper.id,
    report: runPaperChecks(paper),
    decisions: [],
  });
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
  // The figure check belongs to Writing, not Arguments.
  fireEvent.click(await screen.findByRole('tab', { name: /^Arguments/ }));
  expect(await screen.findByRole('button', { name: 'Mở Issues (0)' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /^Writing style/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Mở Issues (1)' }));
  const list = screen.getByRole('region', { name: 'Issues' });
  expect(
    within(within(list).getByRole('group', { name: 'Filter by criterion' }))
      .getAllByRole('button')
      .map((chip) => chip.textContent),
  ).toEqual(['WWriting (1)', 'Theo trang', 'Kiểm tra tự động']);
  expect(within(list).getByRole('button', { name: 'Bác bỏ' })).toBeInTheDocument();
});
