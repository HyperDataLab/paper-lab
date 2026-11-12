import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import { addMember } from '@/core/corpus/intake';
import { CorpusSchema } from '@/core/schemas/corpus';
import { AuthContext } from '@/shared/auth/authContext';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import Page from './Page';
import DetailPage from './DetailPage';

function setup(path: string) {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`corpus-ui-${crypto.randomUUID()}`));
  const mount = () =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <StorageProvider repositories={repo}>
          <Routes>
            <Route path="/corpus" element={<Page />} />
            <Route path="/corpus/:id" element={<DetailPage />} />
          </Routes>
        </StorageProvider>
      </MemoryRouter>,
    );
  return { repo, mount };
}
async function detail() {
  const corpus = { ...exampleCorpus(), members: [] };
  const ctx = setup(`/corpus/${corpus.id}`);
  await ctx.repo.corpora.save(corpus);
  ctx.mount();
  await screen.findByRole('heading', { name: corpus.title });
  return { ...ctx, corpus };
}
it('C1c creates a topic corpus with its first protocol', async () => {
  const { repo, mount } = setup('/corpus');
  mount();
  // Creating opens a dialog from the page header, the way list pages do it elsewhere.
  fireEvent.click(screen.getByRole('button', { name: 'Corpus mới' }));
  expect(screen.getByRole('dialog', { name: 'Tạo corpus' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tên corpus'), { target: { value: 'Review' } });
  fireEvent.change(screen.getByLabelText('Câu hỏi nghiên cứu'), { target: { value: 'Why?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo corpus' }));
  expect(await screen.findByRole('heading', { name: 'Review' })).toBeInTheDocument();
  expect((await repo.corpora.list())[0]?.protocol[0]).toMatchObject({
    version: 1,
    body: { researchQuestion: 'Why?' },
  });
});
it('C1c reports DOI intake counts', async () => {
  await detail();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm bài vào corpus' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Danh sách DOI' }));
  fireEvent.change(screen.getByLabelText('Danh sách DOI'), {
    target: { value: '10.1000/a\n10.1000/b\n10.1000/c\nbad' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Thêm bài' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Đã thêm: 3 · Đã khớp: 0 · Cần xác nhận: 0 · Không hợp lệ: 1',
  );
});
it('C1c confirms and merges title-year matches', async () => {
  const base = exampleCorpus();
  const corpus = addMember(
    { ...base, members: [] },
    { title: 'A study', year: 2020, doi: '10.1000/a' },
    base.createdAt,
  ).corpus;
  const { repo, mount } = setup(`/corpus/${corpus.id}`);
  await repo.corpora.save(corpus);
  const added = await repo.library.addDois(['10.1000/b']);
  const item = added.added[0];
  if (!item) throw new Error('missing item');
  await repo.library.update(item.id, { title: 'A study', year: 2020 });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm bài vào corpus' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'A study' }));
  fireEvent.click(screen.getByRole('button', { name: 'Thêm bài' }));
  expect(await screen.findByText(/Bài mới: A study/)).toBeInTheDocument();
  expect((await repo.corpora.get(corpus.id))?.pendingConfirmations).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Gộp' }));
  await waitFor(async () => expect((await repo.corpora.get(corpus.id))?.aliases).toHaveLength(1));
  expect((await repo.corpora.get(corpus.id))?.members).toHaveLength(1);
});
it('C1c releases the same digest twice without changes', async () => {
  const { repo, corpus } = await detail();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm bài vào corpus' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Danh sách DOI' }));
  fireEvent.change(screen.getByLabelText('Danh sách DOI'), { target: { value: '10.1000/example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Thêm bài' }));
  await screen.findByRole('status');
  fireEvent.click(screen.getByRole('button', { name: 'Phát hành' }));
  await waitFor(async () => expect((await repo.corpora.get(corpus.id))?.releases).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Phát hành' }));
  expect(await screen.findByText(/không đổi so với bản trước/)).toBeInTheDocument();
  const releases = (await repo.corpora.get(corpus.id))?.releases;
  expect(releases?.[0]?.digest).toBe(releases?.[1]?.digest);
});
it('C1c exports a manifest accepted by CorpusSchema', async () => {
  await detail();
  let blob: Blob | undefined;
  vi.stubGlobal('URL', {
    createObjectURL: (value: Blob) => {
      blob = value;
      return 'blob:test';
    },
    revokeObjectURL: vi.fn(),
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Xuất manifest' }));
  expect((click.mock.instances[0] as HTMLAnchorElement | undefined)?.download).toBe(
    'synthetic-corpus.corpus.json',
  );
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    if (blob) reader.readAsText(blob);
    else reject(new Error('missing blob'));
  });
  expect(CorpusSchema.parse(JSON.parse(text)).title).toBe('Synthetic corpus');
  click.mockRestore();
  vi.unstubAllGlobals();
});
it('C1d shows Vietnamese member labels', async () => {
  const corpus = exampleCorpus();
  const { repo, mount } = setup(`/corpus/${corpus.id}`);
  await repo.corpora.save(corpus);
  mount();
  expect(await screen.findByRole('cell', { name: 'Đang tìm' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Siêu dữ liệu' })).toBeInTheDocument();
});
it('C1d offers both choices after a stale write', async () => {
  const corpus = { ...exampleCorpus(), id: crypto.randomUUID() };
  const repo = createRepositories(createDb(`corpus-conflict-${crypto.randomUUID()}`));
  await repo.corpora.save(corpus);
  await repo.corpora.setSyncState(corpus.id, 'old', corpus);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: corpus.id,
              title: corpus.title,
              kind: corpus.kind,
              updatedAt: corpus.updatedAt,
              version: 'old',
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 'new' }), { status: 409 })),
  );
  await repo.corpora.save({ ...corpus, title: 'Local edit' });
  render(
    <MemoryRouter initialEntries={['/corpus']}>
      <AuthContext.Provider
        value={{
          user: { uid: '1', email: 'a@hyperdatalab.org', name: null },
          ready: true,
          error: '',
          signIn: async () => {},
          signOut: async () => {},
          getIdToken: async () => 'token',
        }}
      >
        <StorageProvider repositories={repo}>
          <Page />
        </StorageProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Đồng bộ' }));
  expect(await screen.findByText(/Corpus đã được người khác sửa/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tải bản mới' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Giữ bản của tôi' })).toBeInTheDocument();
  vi.unstubAllGlobals();
});
it('C1c deletes a corpus from its card menu after confirming', async () => {
  const corpus = exampleCorpus();
  const { repo, mount } = setup('/corpus');
  await repo.corpora.save(corpus);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: `Thao tác với ${corpus.title}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Xoá' }));
  // Nothing is removed until the person confirms.
  expect(await repo.corpora.list()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Xoá corpus' }));
  await waitFor(async () => expect(await repo.corpora.list()).toHaveLength(0));
  expect(await screen.findByText('Chưa có corpus nào.')).toBeInTheDocument();
});
