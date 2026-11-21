import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import {
  candidateFromWork,
  cellsFromOutput,
  extractionSource,
  catalogField,
  addFields,
  customField,
  FIELD_CATALOG,
  newProject,
  projectPaperFromPaper,
  reviewCell,
} from '@/core/extraction';
import type { Candidate, ExtractionProject, Paper, ProjectField } from '@/core/schemas';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { ExtractionMatrix } from './ExtractionMatrix';
import Page from './Page';
import ProjectPage from './ProjectPage';
import { testRepositories } from '@/shared/storage/testRepositories';

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

/** The matrix as a paper page holds it: the project in state, saved through the repository. */
function MatrixHost({ initial }: { initial: ExtractionProject }) {
  const [project, setProject] = useState(initial);
  return <ExtractionMatrix project={project} papers={new Map([[paper.id, paper]])} onChange={setProject} />;
}
function mountMatrix(repo: ReturnType<typeof testRepositories>, project: ExtractionProject) {
  return render(
    <MemoryRouter>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson: vi.fn() }}>
          <MatrixHost initial={project} />
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
}

function mount(repo: ReturnType<typeof testRepositories>, path: string) {
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

it('shows one paper as filterable field rows and keeps cell and column actions', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = testRepositories();
  const base = newProject({ id: crypto.randomUUID(), title: 'Một bài', researchQuestion: '', now: at });
  const projectPaper = projectPaperFromPaper(paper);
  const fields = ['methods_used', 'dataset', 'limitations'].map((key) => ({
    ...(catalogField(key) as ProjectField),
    hidden: false,
  }));
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
        { field_key: 'dataset', status: 'found', value: 'Unclear sample', inferred: true, evidence: [] },
        { field_key: 'limitations', status: 'not_found', value: null, inferred: false, evidence: [] },
      ],
    },
    fields,
    extractionSource(projectPaper, paper),
    { paper: projectPaper, runId: crypto.randomUUID(), mode: 'STANDARD', at },
  );
  const first = cells[0];
  if (!first) throw new Error('missing cell');
  const saved = await repo.extraction.save({
    ...base,
    papers: [projectPaper],
    fields,
    cells: [reviewCell(first, 'approve', at), ...cells.slice(1)],
  });
  mountMatrix(repo, saved);
  const table = screen.getByRole('table', { name: 'Trích xuất theo trường' });
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  expect(screen.queryByRole('columnheader', { name: 'Bài báo' })).not.toBeInTheDocument();
  expect(within(table).getByText('Không thấy')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Cần xem lại/ }));
  expect(within(table).getAllByRole('row')).toHaveLength(1);
  expect(within(table).getByRole('rowheader')).toHaveTextContent('Dataset');
  fireEvent.click(screen.getByRole('button', { name: /Đã xác nhận/ }));
  expect(within(table).getAllByRole('row')).toHaveLength(1);
  fireEvent.click(within(table).getByRole('button', { name: 'A survey paper · Methods Used' }));
  const drawer = await screen.findByRole('dialog', { name: 'Chi tiết ô' });
  expect(within(drawer).getByText('an online survey')).toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole('button', { name: 'Hoàn tác' }));
  await waitFor(async () =>
    expect((await repo.extraction.get(saved.id))?.cells[0]?.status).toBe('EXTRACTED'),
  );
  fireEvent.click(within(drawer).getByRole('button', { name: 'Đóng' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn cột Limitations' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Ẩn cột' }));
  await waitFor(() =>
    expect(within(table).queryByRole('rowheader', { name: /Limitations/ })).not.toBeInTheDocument(),
  );
});

it('keeps the horizontal matrix for two papers', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = testRepositories();
  const base = newProject({ id: crypto.randomUUID(), title: 'Hai bài', researchQuestion: '', now: at });
  const first = projectPaperFromPaper(paper);
  const saved = await repo.extraction.save({
    ...base,
    papers: [first, { ...first, key: 'second', title: 'Second paper' }],
    fields: [{ ...(catalogField('methods_used') as ProjectField), hidden: false }],
  });
  mountMatrix(repo, saved);
  expect(screen.getByRole('columnheader', { name: 'Bài báo' })).toBeInTheDocument();
  expect(screen.getByRole('rowheader', { name: /Second paper/ })).toBeInTheDocument();
  expect(screen.queryByRole('table', { name: 'Trích xuất theo trường' })).not.toBeInTheDocument();
});

it('shows every field in a single-paper vertical view with more than 50 columns', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = testRepositories();
  const base = newProject({ id: crypto.randomUUID(), title: 'Một bài', researchQuestion: '', now: at });
  const custom = customField({ label: 'Own field', description: '', instruction: '', existing: [] });
  const withFields = addFields(addFields(base, [custom]), FIELD_CATALOG, 51);
  const saved = await repo.extraction.save({ ...withFields, papers: [projectPaperFromPaper(paper)] });
  mountMatrix(repo, saved);
  expect(
    within(screen.getByRole('table', { name: 'Trích xuất theo trường' })).getAllByRole('row'),
  ).toHaveLength(51);
});

it('creates a project, adds a template of columns and reviews a cell with its evidence', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = testRepositories();
  mount(repo, '/extraction');
  expect(await screen.findByText('Chưa có project nào.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Project mới' }));
  fireEvent.change(screen.getByLabelText('Tên project'), { target: { value: 'So sánh' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo project' }));
  expect(await screen.findByRole('heading', { name: 'So sánh' })).toBeInTheDocument();

  const [created] = await repo.extraction.list();
  if (!created) throw new Error('missing project');
  cleanup();
  mountMatrix(repo, created);
  expect(screen.getByRole('button', { name: 'Chạy trích xuất' })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Thêm cột' }));
  const columns = await screen.findByRole('dialog', { name: 'Thêm cột' });
  expect(within(columns).getByText('Tóm tắt phần abstract.')).toBeInTheDocument();
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
  const withCells = await repo.extraction.save({
    ...project,
    papers: [projectPaper],
    fields: [field],
    cells,
  });
  cleanup();
  mountMatrix(repo, withCells);
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
  const repo = testRepositories();
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
  expect(await screen.findByRole('button', { name: 'Tìm theo kế hoạch' })).toBeDisabled();
  expect(screen.getByText('AI gợi ý: Chọn')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Đưa 0 bài/ })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Duyệt kế hoạch' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Tìm theo kế hoạch' })).toBeEnabled());

  const item = screen.getByText('Edge offloading study').closest('li') as HTMLElement;
  fireEvent.click(within(item).getByRole('button', { name: 'Chọn' }));
  fireEvent.click(await screen.findByRole('button', { name: /Đưa 1 bài/ }));
  await waitFor(async () => expect((await repo.extraction.get(saved.id))?.papers).toHaveLength(1));
  const stored = await repo.extraction.get(saved.id);
  expect(stored?.papers.map((paper) => [paper.key, paper.access])).toEqual([['search:W9', 'METADATA_ONLY']]);
  expect(stored?.deep?.candidates[0]).toMatchObject({
    status: 'included',
    reason: null,
    suggestion: { reason: 'Đúng chủ đề' },
  });
  expect(stored?.deep?.plan?.approvedAt).not.toBeNull();
});

it('citation grounding shows the passage behind a claim and links to it in the paper', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = testRepositories();
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
  await screen.findByRole('heading', { name: saved.title });
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
  const evidence = await screen.findByRole('dialog', { name: 'Evidence từ bài này' });
  expect(within(evidence).getByText('an online survey')).toBeInTheDocument();
  expect(
    within(evidence).getByText('Không có đoạn trích tìm thấy trong bài cho giá trị này.'),
  ).toBeInTheDocument();
  expect(within(evidence).getAllByText(/Dùng cho 1 claim/)).toHaveLength(2);
});
