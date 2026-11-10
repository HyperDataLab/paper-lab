import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { cellsFromOutput, extractionSource, catalogField, projectPaperFromPaper } from '@/core/extraction';
import type { Paper, ProjectField } from '@/core/schemas';
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
