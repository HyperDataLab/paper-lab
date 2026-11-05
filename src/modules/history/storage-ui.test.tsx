import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { analyzeText } from '@/core/text';
import Evaluate from '../evaluate/Page';
import History from './Page';
import Transfer from '../transfer/Page';
it('EV-11 saves an evaluation and deletes it from history', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`ui-${crypto.randomUUID()}`));
  render(
    <MemoryRouter initialEntries={['/evaluate']}>
      <StorageProvider repositories={repo}>
        <Routes>
          <Route path="/evaluate" element={<Evaluate />} />
          <Route path="/history" element={<History />} />
        </Routes>
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
  expect(await screen.findByRole('button', { name: 'Đã lưu' })).toBeDisabled();
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
        <Evaluate />
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
        <Transfer />
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
