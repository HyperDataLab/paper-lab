import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import { addMember } from '@/core/corpus/intake';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { chooseSelectOption } from '@/test/selectOption';
import DetailPage from './DetailPage';

const client = { completeJson: vi.fn(() => Promise.reject(new Error('no network in tests'))) };
async function setup() {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`prisma-ui-${crypto.randomUUID()}`));
  const base = exampleCorpus();
  const corpus = addMember(
    { ...base, members: [] },
    { doi: '10.1000/syn1', title: 'Synthetic record', year: 2020 },
    base.createdAt,
  ).corpus;
  await repo.corpora.save(corpus);
  render(
    <MemoryRouter initialEntries={[`/corpus/${corpus.id}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={client}>
          <Routes>
            <Route path="/corpus/:id" element={<DetailPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: corpus.title });
  return { repo, id: corpus.id };
}

it('C3b excluding needs a reason, full text follows an include, and PRISMA counts the decisions', async () => {
  const { repo, id } = await setup();
  fireEvent.change(screen.getByLabelText('Người quyết định'), { target: { value: 'An' } });
  const row = () => screen.getByRole('group', { name: 'Quyết định cho Synthetic record' });
  fireEvent.click(within(row()).getByRole('button', { name: 'Loại' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Chọn lý do loại.');
  chooseSelectOption('Giai đoạn', 'Toàn văn');
  expect(screen.getByText('Chưa có bài nào được chọn ở bước tiêu đề và tóm tắt.')).toBeInTheDocument();
  chooseSelectOption('Giai đoạn', 'Tiêu đề và tóm tắt');
  fireEvent.click(within(row()).getByRole('button', { name: 'Chọn' }));
  await waitFor(async () => expect((await repo.corpora.get(id))?.members[0]?.decisions).toHaveLength(1));
  chooseSelectOption('Giai đoạn', 'Toàn văn');
  chooseSelectOption('Lý do loại', 'Sai thiết kế nghiên cứu');
  fireEvent.click(within(row()).getByRole('button', { name: 'Loại' }));
  await waitFor(async () => expect((await repo.corpora.get(id))?.members[0]?.decisions).toHaveLength(2));
  const flow = screen.getByLabelText('PRISMA: Sàng lọc');
  expect(within(flow).getByText('Báo cáo bị loại, kèm lý do').nextSibling).toHaveTextContent('1');
  expect(within(flow).getByText('— Sai thiết kế nghiên cứu').nextSibling).toHaveTextContent('1');
  expect(screen.getByRole('button', { name: 'Tải PRISMA (CSV)' })).toBeInTheDocument();
});

it('C3b imports a RIS export as a search entry and deduplicates it', async () => {
  const { repo, id } = await setup();
  const ris =
    'TY  - JOUR\nTI  - Synthetic record\nDO  - 10.1000/syn1\nER  -\nTY  - JOUR\nTI  - Another\nDO  - 10.1000/syn2\nER  -\n';
  fireEvent.change(screen.getByLabelText('Nhập kết quả tìm kiếm'), {
    target: { files: [new File([ris], 'scopus.ris', { type: 'application/x-research-info-systems' })] },
  });
  expect(await screen.findByText(/Đã nhập 2 bản ghi: thêm 1 · trùng 1/u)).toBeInTheDocument();
  const saved = await repo.corpora.get(id);
  expect(saved?.members).toHaveLength(2);
  expect(saved?.searches[0]).toMatchObject({
    fileName: 'scopus.ris',
    format: 'ris',
    records: 2,
    duplicates: 1,
  });
});
