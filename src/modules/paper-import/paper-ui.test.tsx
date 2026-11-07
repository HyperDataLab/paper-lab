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
  await screen.findByText('The first paragraph.');
}
it('imports a paper, persists and audits role edits, then prefills Evaluate', async () => {
  const repo = setup();
  await importPaper();
  expect(screen.getByText('sec1_p01')).toBeInTheDocument();
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
