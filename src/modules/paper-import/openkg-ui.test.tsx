import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mapOpenAlex, mergeLookups } from '@/core/library';
import { DEFINITION, fixturePaper, PAPER_ID } from '@/core/measurement/testFixture';
import { sentenceIndex } from '@/core/paperModel';
import { downloadText } from '@/shared/calibration/download';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import type { Repositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import PaperMapPage from './PaperMapPage';
import { testRepositories } from '@/shared/storage/testRepositories';

vi.mock('@/shared/calibration/download', { spy: true });

const paper = { ...fixturePaper, source: { ...fixturePaper.source, kind: 'text' as const } };
const openKg = 'Đồ thị tri thức (OpenKG)';

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  // The graph view (React Flow) measures its nodes with ResizeObserver, which jsdom does not provide.
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.mocked(downloadText).mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function seed(repo: Repositories) {
  const {
    added: [item],
  } = await repo.library.addDois(['10.1000/graph']);
  if (!item) throw new Error('Test DOI was not added');
  const openalex = mapOpenAlex({
    id: 'W1',
    keywords: [{ id: 'keywords/accuracy', display_name: 'Accuracy', score: 0.6 }],
    referenced_works: ['W2'],
    primary_topic: { id: 'T1', display_name: 'Measurement' },
    authorships: [{ author: { id: 'A1', display_name: 'A. Test' } }],
  });
  await repo.library.update(item.id, {
    ...mergeLookups({ openalex, crossref: null, oa: [], incomplete: false }),
    paper_id: paper.id,
    lookup: 'done',
  });
  const sentence = sentenceIndex(paper).find((s) => s.text === DEFINITION);
  if (!sentence) throw new Error('Test sentence was not indexed');
  const at = paper.createdAt;
  await repo.scg.save({
    schemaVersion: 1,
    paperId: paper.id,
    doi: item.doi,
    s2CorpusId: null,
    s2CheckedAt: null,
    idBase: paper.id,
    promptVersion: 'test',
    promptVersions: { contributions: 'test', prerequisites: 'test', alignment: 'test' },
    requestedModel: 'test',
    model: 'test',
    status: 'complete',
    callsUsed: 0,
    dropped: { quotes: 0, contributions: 0, prerequisites: 0, references: 0, matches: 0 },
    progress: { fingerprint: '', contributionBatches: {}, prerequisitesDone: [], alignmentDone: [] },
    contributions: [
      {
        id: `${paper.id}.c0`,
        name: 'Synthetic contribution',
        description: '',
        review: 'accepted',
        types: [{ type: 'analysis', explanation: '' }],
        sections: ['Methods'],
        prerequisites: [],
        sourceSentenceKeys: [sentence.key],
      },
    ],
    reviewCarry: {},
    createdAt: at,
    updatedAt: at,
  });
  await repo.paperInsights.saveArgumentRun(paper.id, {
    id: crypto.randomUUID(),
    createdAt: at,
    model: 'test',
    promptVersion: 'test',
    callsUsed: 0,
    sectionIds: [sentence.sectionId],
    failedSectionIds: [],
    arguments: [
      {
        id: 'arg-1',
        importance: 'main',
        claim: {
          paragraphId: sentence.paragraphId,
          sectionId: sentence.sectionId,
          page: sentence.page,
          start: sentence.start,
          end: sentence.end,
          excerpt: sentence.text,
        },
        claimType: null,
        data: [],
        backing: [],
        statedWarrant: null,
        inferredWarrant: null,
        qualifier: null,
        rebuttals: [],
        evidenceLevel: 'E2',
      },
    ],
    discarded: { claim_not_found: 0, element_not_found: 0, duplicate: 0 },
  });
}

async function openPaper(populated: boolean) {
  const repo = testRepositories();
  await repo.papers.create(paper);
  if (populated) await seed(repo);
  render(
    <MemoryRouter initialEntries={[`/papers/${PAPER_ID}${populated ? '' : '?view=openkg'}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson: vi.fn() }}>
          <Routes>
            <Route path="/papers/:id" element={<PaperMapPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  return screen.findByRole('tab', { name: openKg });
}

it('opens the graph tab, shows five layer counts and lets a reader inspect, filter and export', async () => {
  fireEvent.click(await openPaper(true));
  const graph = await screen.findByRole('group', { name: 'Đồ thị tri thức của bài báo' });
  const layers = within(screen.getByRole('group', { name: 'Số bộ ba theo lớp' }));
  expect(layers.getAllByRole('checkbox')).toHaveLength(5);
  for (const name of [
    'Evidence (1)',
    'Khái niệm (2)',
    'Chuyên ngành (1)',
    'Chuyên môn (1)',
    'Đánh giá (2)',
  ]) {
    expect(layers.getByRole('checkbox', { name })).toBeChecked();
  }
  const contribution = within(graph).getByRole('button', { name: 'Synthetic contribution' });
  fireEvent.keyDown(contribution, { key: 'Enter' });
  const panel = within(screen.getByRole('complementary', { name: 'Chi tiết nút' }));
  expect(panel.getByRole('heading', { name: 'Synthetic contribution' })).toBeInTheDocument();
  expect(panel.getByText('có contribution')).toBeInTheDocument();
  expect(panel.getByText('Đã chấp nhận')).toBeInTheDocument();
  fireEvent.click(panel.getByRole('button', { name: 'Xem trong bài' }));
  const drawer = screen.getByRole('dialog', { name: 'Evidence trong bài' });
  expect(drawer.querySelector('mark')).toHaveTextContent(DEFINITION);
  fireEvent.keyDown(drawer, { key: 'Escape' });

  fireEvent.click(layers.getByRole('checkbox', { name: 'Khái niệm (2)' }));
  expect(within(graph).queryByRole('button', { name: 'Synthetic contribution' })).not.toBeInTheDocument();
  expect(within(graph).getByRole('button', { name: 'Synthetic paper' })).toBeInTheDocument();
  fireEvent.click(screen.getByText('Danh sách bộ ba (5)'));
  expect(await screen.findByText('có mức evidence')).toBeVisible();
  expect(screen.queryByText('có keyword')).not.toBeInTheDocument();
  for (const name of ['Turtle (.ttl)', 'JSON-LD (.jsonld)', 'Báo cáo (.md)']) {
    fireEvent.click(screen.getByRole('button', { name }));
  }
  expect(downloadText).toHaveBeenNthCalledWith(
    1,
    `openkg-${PAPER_ID}.ttl`,
    expect.stringContaining('pl:contributes'),
    'text/turtle',
  );
  expect(downloadText).toHaveBeenNthCalledWith(
    2,
    `openkg-${PAPER_ID}.jsonld`,
    expect.stringContaining('"@graph"'),
    'application/ld+json',
  );
  expect(downloadText).toHaveBeenNthCalledWith(
    3,
    `openkg-${PAPER_ID}.md`,
    expect.stringContaining('## Evidence levels'),
    'text/markdown',
  );
});

it('opens from the shared view address and explains missing sources', async () => {
  expect(await openPaper(false)).toHaveAttribute('aria-selected', 'true');
  const notices = within(await screen.findByRole('list', { name: 'Dữ liệu còn thiếu' }));
  expect(notices.getAllByText('Chưa có dữ liệu OpenAlex trong Thư viện DOI.')).toHaveLength(2);
  expect(notices.getByText('Chưa chạy SCG để lấy contribution và nền tảng.')).toBeInTheDocument();
  expect(notices.getByText('Chưa chạy phân tích argument.')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Khái niệm (0)' })).toBeChecked();
});
