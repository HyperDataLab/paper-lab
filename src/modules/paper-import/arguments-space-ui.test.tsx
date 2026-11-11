import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixturePaper, fixtureRun, PAPER_ID } from '@/core/measurement/testFixture';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { PaperAtomics } from './PaperAtomics';
import PaperMapPage from './PaperMapPage';

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

/** A stored measurement with one atomic sentence in Methods and one in Results. */
async function seeded() {
  const repo = createRepositories(createDb(`args-space-${crypto.randomUUID()}`));
  await repo.papers.create(fixturePaper);
  const run = fixtureRun();
  const evidence = run.profile.evidence[0]!;
  run.profile.atomic_sentences = [
    {
      id: 'as-0001',
      text: 'Accuracy is the share of correct predictions.',
      role: 'method',
      word_count: 7,
      evidence_id: evidence.id,
      page: 2,
      section_id: 'met',
      needs_review: false,
      human_checked: false,
    },
    {
      id: 'as-0002',
      text: 'The baseline is robust under client dropout.',
      role: 'finding',
      word_count: 7,
      evidence_id: 'missing-evidence',
      page: 3,
      section_id: 'res',
      needs_review: true,
      human_checked: false,
    },
  ];
  await repo.measurements.saveRun(PAPER_ID, run);
  return { repo, evidence };
}

it('R10b atomic sentences are listed by section, filtered by role, and open their passage', async () => {
  const { repo, evidence } = await seeded();
  const record = await repo.measurements.get(PAPER_ID);
  const onLocation = vi.fn();
  render(<PaperAtomics paper={fixturePaper} record={record} onLocation={onLocation} onOpen={vi.fn()} />);
  expect(screen.getByText('2/2 atomic sentences')).toBeInTheDocument();
  const methods = screen.getByRole('region', { name: 'Methods' });
  expect(within(methods).getByText('Accuracy is the share of correct predictions.')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Results' })).getByText('Cần duyệt')).toBeInTheDocument();
  fireEvent.click(within(methods).getByRole('button', { name: 'Tr. 2' }));
  expect(onLocation).toHaveBeenCalledWith({
    paragraphId: evidence.blockId,
    start: evidence.span?.start ?? 0,
    end: evidence.span?.end ?? 1,
  });
  // A sentence whose evidence is gone keeps its place but offers no source.
  expect(within(screen.getByRole('region', { name: 'Results' })).queryByRole('button')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Finding/ }));
  expect(screen.getByText('1/2 atomic sentences')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Results' })).toBeNull();
});

it('R10b without a measurement the list says where atomic sentences come from', () => {
  const onOpen = vi.fn();
  render(<PaperAtomics paper={fixturePaper} record={undefined} onLocation={vi.fn()} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mở Evidence & measurement' }));
  expect(onOpen).toHaveBeenCalled();
});

it('R10b the Arguments space opens on gap, claims and atomic sentences, ahead of the AI analyses', async () => {
  const { repo } = await seeded();
  render(
    <MemoryRouter initialEntries={[`/papers/${PAPER_ID}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson: vi.fn() }}>
          <Routes>
            <Route path="/papers/:id" element={<PaperMapPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Arguments →' }));
  const jump = screen.getByRole('group', { name: 'Jump to' });
  expect(
    within(jump)
      .getAllByRole('button')
      .map((chip) => chip.textContent?.slice(1)),
  ).toEqual([
    'Issues',
    'Research gap & contribution',
    'Claims & grounds',
    'Atomic sentences',
    'Claims & reasoning',
    'Evidence & measurement',
    'Validity & rhetorical moves',
    'AI peer review',
  ]);
  expect(await screen.findByText('Accuracy is the share of correct predictions.')).toBeInTheDocument();
  // Parts with nothing stored yet say so and point to the analysis that fills them.
  expect(screen.getByText('Chưa phân tích cách tác giả dẫn dắt.')).toBeInTheDocument();
  expect(screen.getByText('Chưa phân tích lập luận.')).toBeInTheDocument();
});

it('R10c the profile dimensions move from Summary into the spaces, and Writing style opens on vocabulary', async () => {
  const { repo } = await seeded();
  render(
    <MemoryRouter initialEntries={[`/papers/${PAPER_ID}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson: vi.fn() }}>
          <Routes>
            <Route path="/papers/:id" element={<PaperMapPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: 'Summary' }));
  expect(screen.queryByRole('region', { name: 'Hồ sơ bài báo' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Arguments →' }));
  const args = await screen.findByRole('region', { name: 'Arguments overview' });
  expect(
    within(args)
      .getAllByRole('article')
      .map((card) => card.getAttribute('aria-label')),
  ).toEqual(['Khoa học và Tri thức', 'Lập luận']);
  fireEvent.click(screen.getByRole('tab', { name: 'Writing style' }));
  const writing = await screen.findByRole('region', { name: 'Writing overview' });
  expect(within(writing).getAllByRole('article')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Thu gọn Vocabulary & phrases' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});
