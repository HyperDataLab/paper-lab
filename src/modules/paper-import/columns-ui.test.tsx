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

it('R7 an old view link opens its tab on the right while the paper stays in the centre, and what needs review is announced', async () => {
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
  expect(within(spaces).getByRole('tab', { name: 'Arguments' })).toHaveAttribute('aria-selected', 'true');
  expect(document.querySelector('section[aria-label="Paper"]')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '← Quay lại bài' }));
  const centre = await screen.findByRole('tablist', { name: 'Paper' });
  expect(within(centre).getByRole('tab', { name: 'Full text' })).toHaveAttribute('aria-selected', 'true');
  const right = screen.getByRole('tablist', { name: 'Analysis' });
  expect(
    within(right)
      .getAllByRole('tab')
      .map((tab) => tab.textContent?.replace(/\d+$/, '')),
  ).toEqual(['Issues', 'Citations', 'Paper info']);
  // Both spaces are entered from above the right column's tabs.
  const entries = screen.getByRole('navigation', { name: 'Spaces' });
  expect(within(entries).getByRole('button', { name: /^Arguments/ })).toBeInTheDocument();
  expect(within(entries).getByRole('button', { name: /^Writing style/ })).toBeInTheDocument();
  // The rule check's finding needs a person's decision: the header says so and the tab carries the count.
  const pill = await screen.findByRole('button', { name: '1 cần duyệt' });
  expect(within(right).getByRole('tab', { name: 'Issues' })).toHaveTextContent('Issues1');
  fireEvent.click(pill);
  expect(within(right).getByRole('tab', { name: 'Issues' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('1 phát hiện cần bạn duyệt.')).toBeInTheDocument();
  // Each tab says what a reader comes to it for.
  expect(screen.getByText(/Những điểm cần bạn xem và quyết định/)).toBeInTheDocument();
});

it('R7 issues are grouped by type of problem, with what needs review first and then the most severe', () => {
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
        finding('evidence low', 'evidence', 'low', 'open'),
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
    'C Claims & reasoning 1 cần duyệt / 2',
    'E Evidence & data 2 cần duyệt / 2',
    'S Sources & citations 1 cần duyệt / 1',
    'W Writing 1 cần duyệt / 1',
  ]);
  expect([...list.querySelectorAll('article strong')].map((title) => title.textContent)).toEqual([
    'claim low',
    'claim confirmed high',
    'evidence high',
    'evidence low',
    'source medium',
    'writing low',
  ]);
  // The notice narrows the list to what still needs a decision.
  fireEvent.click(screen.getByRole('button', { name: 'Chỉ hiện mục cần duyệt' }));
  expect([...list.querySelectorAll('article strong')].map((title) => title.textContent)).not.toContain(
    'claim confirmed high',
  );
});
