import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import {
  candidateFromWork,
  cellsFromOutput,
  extractionSource,
  catalogField,
  newProject,
  projectPaperFromPaper,
} from '@/core/extraction';
import type { Candidate, Paper, ProjectField } from '@/core/schemas';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import Page from './Page';
import ProjectPage from './ProjectPage';

const at = '2026-01-01T00:00:00.000Z';
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: 'A survey paper',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'pdf', fileName: 'a.pdf', pageCount: 1, sha256: 'x' },
  sections: [{ id: 's', heading: 'Methods', role: 'methods', level: 1, pageStart: 2 }],
  paragraphs: [
    {
      id: 'p',
      sectionId: 's',
      order: 0,
      text: 'We ran an online survey.',
      kind: 'body',
      textHash: 'p',
      pageStart: 2,
    },
  ],
};

function mount(repo: ReturnType<typeof createRepositories>, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson: vi.fn() }}>
          <Routes>
            <Route path="/extraction" element={<Page />} />
            <Route path="/extraction/:id" element={<ProjectPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
}

it('creates a project, adds a template of columns and reviews a cell with its evidence', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`extraction-ui-${crypto.randomUUID()}`));
  mount(repo, '/extraction');
  expect(await screen.findByText('Chưa có project nào.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tên project'), { target: { value: 'So sánh' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo project' }));
  expect(await screen.findByRole('heading', { name: 'So sánh' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Chạy trích xuất' })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Thêm cột' }));
  const columns = await screen.findByRole('dialog', { name: 'Thêm cột' });
  fireEvent.click(within(columns).getByRole('button', { name: 'Lý thuyết' }));
  fireEvent.click(within(columns).getByRole('button', { name: 'Thêm 6 cột' }));
  expect(await screen.findByText('0 bài · 6 cột · 0 ô đã xác nhận')).toBeInTheDocument();

  const [project] = await repo.extraction.list();
  if (!project) throw new Error('missing project');
  const projectPaper = projectPaperFromPaper(paper);
  const field = { ...(catalogField('methods_used') as ProjectField), hidden: false };
  const cells = cellsFromOutput(
    {
      fields: [
        {
          field_key: 'methods_used',
          status: 'found',
          value: 'Online survey',
          inferred: false,
          evidence: [{ paragraphId: 'p', quote: 'an online survey' }],
        },
      ],
    },
    [field],
    extractionSource(projectPaper, paper),
    { paper: projectPaper, runId: '00000000-0000-4000-8000-000000000002', mode: 'STANDARD', at },
  );
  await repo.extraction.save({ ...project, papers: [projectPaper], fields: [field], cells });
  mount(repo, `/extraction/${project.id}`);
  fireEvent.click(await screen.findByRole('button', { name: 'A survey paper · Methods Used' }));
  const drawer = await screen.findByRole('dialog', { name: 'Chi tiết ô' });
  expect(within(drawer).getByText('an online survey')).toBeInTheDocument();
  expect(within(drawer).getByText('Tr. 2 · Methods')).toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole('button', { name: 'Xác nhận' }));
  await waitFor(async () =>
    expect((await repo.extraction.get(project.id))?.cells[0]?.status).toBe('VERIFIED'),
  );
  expect(
    (await repo.audit.listByAnalysis(project.id)).items.some((event) => event.action === 'review_extraction'),
  ).toBe(true);
});

it('Deep Research waits for an approved plan and leaves screening decisions to a person', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`extraction-deep-${crypto.randomUUID()}`));
  const base = newProject({
    id: crypto.randomUUID(),
    title: 'Tìm bài',
    researchQuestion: 'Độ trễ edge?',
    now: at,
  });
  const candidate = candidateFromWork(
    { id: 'https://openalex.org/W9', display_name: 'Edge offloading study', publication_year: 2024 },
    'edge latency',
  ) as Candidate;
  const saved = await repo.extraction.save({
    ...base,
    deep: {
      plan: {
        concepts: [],
        queries: ['edge latency'],
        inclusion: [],
        exclusion: [],
        fromYear: null,
        toYear: null,
        perQuery: 15,
        approvedAt: null,
      },
      rounds: [],
      candidates: [{ ...candidate, suggestion: { decision: 'included', reason: 'Đúng chủ đề' } }],
      syntheses: [],
    },
  });
  mount(repo, `/extraction/${saved.id}`);
  fireEvent.click(await screen.findByRole('radio', { name: 'Deep Research' }));
  expect(screen.getByRole('button', { name: 'Tìm theo kế hoạch' })).toBeDisabled();
  expect(screen.getByText('AI gợi ý: Chọn')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Đưa 0 bài/ })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Duyệt kế hoạch' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Tìm theo kế hoạch' })).toBeEnabled());

  const item = screen.getByText('Edge offloading study').closest('li') as HTMLElement;
  fireEvent.click(within(item).getByRole('button', { name: 'Chọn' }));
  fireEvent.click(await screen.findByRole('button', { name: /Đưa 1 bài/ }));
  await waitFor(() =>
    expect(screen.getByRole('radio', { name: 'Ma trận' })).toHaveAttribute('aria-checked', 'true'),
  );
  expect(screen.getByText(/^1 bài · /)).toBeInTheDocument();
  const stored = await repo.extraction.get(saved.id);
  expect(stored?.papers.map((paper) => [paper.key, paper.access])).toEqual([['search:W9', 'METADATA_ONLY']]);
  expect(stored?.deep?.candidates[0]).toMatchObject({ status: 'included', reason: 'Đúng chủ đề' });
  expect(stored?.deep?.plan?.approvedAt).not.toBeNull();
});

it('citation grounding shows the passage behind a claim and links to it in the paper', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`extraction-grounding-${crypto.randomUUID()}`));
  const base = newProject({ id: crypto.randomUUID(), title: 'Đối chiếu', researchQuestion: '', now: at });
  const projectPaper = projectPaperFromPaper(paper);
  const quote = {
    paragraphId: 'p',
    section: 'Methods',
    page: 2,
    start: 9,
    end: 25,
    quote: 'an online survey',
  };
  const citation = {
    paperKey: projectPaper.key,
    fieldKey: 'methods_used',
    fieldLabel: 'Methods Used',
    value: 'Online survey',
    fullText: true,
    humanVerified: false,
  };
  const saved = await repo.extraction.save({
    ...base,
    papers: [projectPaper],
    deep: {
      plan: null,
      rounds: [],
      candidates: [],
      syntheses: [
        {
          id: crypto.randomUUID(),
          createdAt: at,
          model: 'm',
          promptVersion: 'synthesis-3',
          paperKeys: [projectPaper.key],
          droppedRefs: 0,
          claims: [
            {
              kind: 'theme',
              text: 'Bài dùng khảo sát trực tuyến.',
              paperKeys: [projectPaper.key],
              caveat: null,
              supported: true,
              citations: [{ ...citation, quotes: [quote] }],
            },
            {
              kind: 'agreement',
              text: 'Nhận định không có đoạn trích.',
              paperKeys: [projectPaper.key],
              caveat: null,
              supported: true,
              citations: [{ ...citation, fieldKey: 'results', fieldLabel: 'Results', quotes: [] }],
            },
          ],
        },
      ],
    },
  });
  mount(repo, `/extraction/${saved.id}`);
  fireEvent.click(await screen.findByRole('radio', { name: 'Deep Research' }));
  // Only the claim whose citation has no passage is flagged.
  expect(screen.getAllByText('Chưa có đoạn trích kiểm chứng')).toHaveLength(1);
  const chip = screen.getByRole('button', { name: 'Trích dẫn 1: A survey paper · Methods Used' });
  expect(chip).toHaveTextContent('[1] Methods Used · toàn văn');
  expect(chip).toHaveAttribute('title', 'an online survey');
  expect(screen.getByRole('button', { name: /· Results$/ })).toHaveTextContent('không có đoạn trích');

  fireEvent.click(chip);
  const card = await screen.findByRole('dialog', { name: 'Trích dẫn nguồn' });
  expect(within(card).getByText('an online survey')).toBeInTheDocument();
  expect(within(card).getByText('Đã dùng toàn văn')).toBeInTheDocument();
  expect(within(card).getByText('Bài dùng khảo sát trực tuyến.')).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'Xem đoạn này trong bài' })).toHaveAttribute(
    'href',
    `/papers/${paper.id}?p=p&s=9&e=25`,
  );
  fireEvent.click(within(card).getByRole('button', { name: 'Đóng' }));

  fireEvent.click(screen.getByRole('button', { name: '1 đoạn trích' }));
  const evidence = await screen.findByRole('dialog', { name: 'Bằng chứng từ bài này' });
  expect(within(evidence).getByText('an online survey')).toBeInTheDocument();
  expect(
    within(evidence).getByText('Không có đoạn trích tìm thấy trong bài cho giá trị này.'),
  ).toBeInTheDocument();
  expect(within(evidence).getAllByText(/Dùng cho 1 nhận định/)).toHaveLength(2);
});
