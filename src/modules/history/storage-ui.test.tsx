import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { analyzeText } from '@/core/text';
import Evaluate from '../evaluate/Page';
import History from './Page';
import Transfer from '../transfer/Page';
it('AC-08 removes deleted analyses from comparison selection and allows another selection', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`history-selection-${crypto.randomUUID()}`));
  const first = await repo.analyses.create({ text: await analyzeText('First sentence.') });
  await repo.analyses.create({ text: await analyzeText('Second sentence.') });
  await repo.analyses.create({ text: await analyzeText('Third sentence.') });
  render(
    <MemoryRouter>
      <StorageProvider repositories={repo}>
        <History />
      </StorageProvider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn để so sánh: First sentence.' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn để so sánh: Second sentence.' }));
  expect(screen.getByRole('link', { name: 'So sánh hai bản phân tích' })).toHaveAttribute(
    'href',
    expect.stringContaining(first.id),
  );
  const row = screen.getByRole('checkbox', { name: 'Chọn để so sánh: First sentence.' }).closest('li');
  if (!row) throw new Error('Missing history row');
  fireEvent.click(within(row).getByRole('button', { name: 'Xoá' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xoá bản phân tích' }));
  await waitFor(() =>
    expect(screen.queryByRole('link', { name: 'So sánh hai bản phân tích' })).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn để so sánh: Third sentence.' }));
  expect(screen.getByRole('link', { name: 'So sánh hai bản phân tích' })).not.toHaveAttribute(
    'href',
    expect.stringContaining(first.id),
  );
});
it('U5 history search narrows the list and the page keeps a single h1', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`history-search-${crypto.randomUUID()}`));
  await repo.analyses.create({ text: await analyzeText('Alpha sentence.') });
  await repo.analyses.create({ text: await analyzeText('Beta sentence.') });
  render(
    <MemoryRouter>
      <StorageProvider repositories={repo}>
        <History />
      </StorageProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByRole('link', { name: 'Alpha sentence.' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Bản phân tích (2)' })).toHaveAttribute('aria-checked', 'true');
  fireEvent.change(screen.getByLabelText('Tìm trong lịch sử'), { target: { value: 'beta' } });
  expect(screen.queryByRole('link', { name: 'Alpha sentence.' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Beta sentence.' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tìm trong lịch sử'), { target: { value: 'zzz' } });
  expect(screen.getByText('Không có bản phân tích nào khớp.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Đoạn đã soạn (0)' }));
  expect(screen.getByText('Chưa có đoạn đã soạn.')).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
});
it('EV-11 saves an evaluation and deletes it from history', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`ui-${crypto.randomUUID()}`));
  render(
    <MemoryRouter initialEntries={['/evaluate']}>
      <StorageProvider repositories={repo}>
        <LlmProvider>
          <Routes>
            <Route path="/evaluate" element={<Evaluate />} />
            <Route path="/history" element={<History />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Dán một đoạn văn tiếng Anh'), {
    target: { value: 'A scientific sentence.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tách câu' }));
  const save = await screen.findByRole('button', { name: 'Lưu vào lịch sử' });
  fireEvent.click(save);
  fireEvent.click(save);
  expect(await screen.findByRole('button', { name: 'Đã lưu' }, { timeout: 10000 })).toBeDisabled();
  expect((await repo.analyses.list()).items).toHaveLength(1);
  fireEvent.click(await screen.findByRole('link', { name: 'Xem trong Lịch sử' }));
  expect(await screen.findByRole('link', { name: 'A scientific sentence.' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xoá' }));
  expect(screen.getByRole('button', { name: 'Huỷ' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Xoá' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Xoá' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xoá bản phân tích' }));
  expect(await screen.findByText('Chưa có bản phân tích')).toBeInTheDocument();
});
it('EV-11 shows a not-found state for an unknown analysis', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`ui-${crypto.randomUUID()}`));
  render(
    <MemoryRouter initialEntries={[`/evaluate?id=${crypto.randomUUID()}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider>
          <Evaluate />
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByText('Không tìm thấy bản phân tích này.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Quay lại Lịch sử' })).toBeInTheDocument();
});
it('EV-12 previews and imports a JSON package', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const source = createRepositories(createDb(`ui-${crypto.randomUUID()}`));
  await source.analyses.create({ text: await analyzeText('Imported sentence.') });
  const data = await source.transfer.exportAll('1');
  const repo = createRepositories(createDb(`ui-${crypto.randomUUID()}`));
  render(
    <MemoryRouter>
      <StorageProvider repositories={repo}>
        <LlmProvider>
          <Transfer />
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  const file = new File([JSON.stringify(data)], 'data.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(data) });
  fireEvent.change(screen.getByLabelText('Nhập từ tệp'), { target: { files: [file] } });
  expect(await screen.findByText('Mới')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Nhập' }));
  await waitFor(async () => expect((await repo.analyses.list()).items).toHaveLength(1));
});
