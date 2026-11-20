import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import { addMember } from '@/core/corpus/intake';
import { CorpusSchema } from '@/core/schemas/corpus';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { CompositeDocStore } from '@/shared/storage/compositeDocStore';
import { DexieDocStore } from '@/shared/storage/dexieDocStore';
import { testWorkerData } from '@/shared/storage/remoteTestSupport';
import Page from './Page';
import DetailPage from './DetailPage';

// The labelling card needs a model client; no test here lets it reach the network.
const client = { completeJson: vi.fn(() => Promise.reject(new Error('no network in tests'))) };
function setup(path: string, auth?: AuthValue) {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`corpus-ui-${crypto.randomUUID()}`));
  const mount = () => {
    const page = (
      <MemoryRouter initialEntries={[path]}>
        <StorageProvider repositories={repo}>
          <LlmProvider innerClient={client}>
            <Routes>
              <Route path="/corpus" element={<Page />} />
              <Route path="/corpus/:id" element={<DetailPage />} />
            </Routes>
          </LlmProvider>
        </StorageProvider>
      </MemoryRouter>
    );
    return render(auth ? <AuthContext.Provider value={auth}>{page}</AuthContext.Provider> : page);
  };
  return { repo, mount };
}

it('queues eligible members even when filtered out and refreshes the lab KG counts', async () => {
  let corpus = { ...exampleCorpus(), members: [] as ReturnType<typeof exampleCorpus>['members'] };
  for (const item of [
    { doi: '10.1000/synthetic', title: 'DOI record' },
    { openalexId: 'https://openalex.org/W12', title: 'OpenAlex record' },
    { title: 'Record with no ID' },
  ])
    corpus = addMember(corpus, item, corpus.createdAt).corpus;
  const { repo, mount } = setup(`/corpus/${corpus.id}`, {
    user: { uid: 'lab', email: 'lab@example.invalid', name: null },
    ready: true,
    error: '',
    getIdToken: async () => 'token',
    signIn: async () => {},
    signOut: async () => {},
  });
  let pending = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/kg/ingest/status'))
      return Response.json({ counts: { pending, done: 0, processing: 0, failed: 0 }, logs: [] });
    if (String(input).endsWith('/kg/ingest')) {
      expect(JSON.parse(String(init?.body))).toEqual({ ids: ['10.1000/synthetic', 'W12'] });
      pending = 2;
      return Response.json({ queued: 2, processed: 0, skipped: 0, errors: [] }, { status: 202 });
    }
    return Response.json({}, { status: 404 });
  });
  vi.stubGlobal('fetch', fetcher);
  try {
    await repo.corpora.save(corpus);
    mount();
    expect(await screen.findByText(/KG của lab · Chờ 0/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: 'Trạng thái thu thập' }));
    fireEvent.click(screen.getByRole('option', { name: 'Không lấy được' }));
    expect(screen.queryByRole('cell', { name: 'DOI record' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Đưa vào KG của lab' }));
    expect(await screen.findByText(/Đã xếp 2/)).toBeInTheDocument();
    expect(await screen.findByText(/KG của lab · Chờ 2/)).toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
  }
});
async function detail() {
  const corpus = { ...exampleCorpus(), members: [] };
  const ctx = setup(`/corpus/${corpus.id}`);
  await ctx.repo.corpora.save(corpus);
  ctx.mount();
  await screen.findByRole('heading', { name: corpus.title });
  return { ...ctx, corpus };
}
it('shows the saved topic and weak assignment on a corpus member row', async () => {
  const base = exampleCorpus();
  const corpus = addMember(
    { ...base, members: [] },
    { title: 'Synthetic member', doi: '10.1000/topic' },
    base.createdAt,
  ).corpus;
  const member = corpus.members[0];
  if (!member) throw new Error('missing member');
  const { repo, mount } = setup(`/corpus/${corpus.id}`);
  await repo.corpora.save(corpus);
  await repo.corpusTopics.save({
    format: 'paperlab-corpus-topics',
    schemaVersion: 1,
    snapshotId: 'member-run',
    createdAt: '2026-01-01T00:00:00Z',
    corpora: [{ corpusId: corpus.id, kind: corpus.kind, title: corpus.title }],
    pipeline: {
      tag: 'test',
      embeddingModel: 'test',
      parameters: {},
      seed: 1,
      textSource: 'abstract',
      openalexFetchedAt: '2026-01-01T00:00:00Z',
    },
    quality: { outlierShare: 0 },
    topics: [
      {
        topicId: 0,
        size: 1,
        byCorpus: { [corpus.id]: 1 },
        words: ['topic word'],
        representativeMemberIds: [member.memberId],
        openalexSubfields: [],
      },
    ],
    members: [
      {
        corpusId: corpus.id,
        memberId: member.memberId,
        topicId: 0,
        probability: 0.2,
        weak: true,
        keyphrases: ['key phrase'],
        textUsed: 'abstract',
      },
    ],
  });
  mount();
  expect(await screen.findByText(/Chủ đề: topic word/)).toHaveTextContent('gán yếu');
  expect(screen.getByText(/Chủ đề: topic word/)).toHaveTextContent('key phrase');
});
it('C1c creates a topic corpus with its first protocol', async () => {
  const { repo, mount } = setup('/corpus');
  mount();
  // Creating opens a dialog from the page header, the way list pages do it elsewhere.
  fireEvent.click(screen.getByRole('button', { name: 'Corpus mới' }));
  expect(screen.getByRole('dialog', { name: 'Tạo corpus' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tên corpus'), { target: { value: 'Review' } });
  fireEvent.change(screen.getByLabelText('Research question'), { target: { value: 'Why?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo corpus' }));
  expect(await screen.findByRole('heading', { name: 'Review' })).toBeInTheDocument();
  expect((await repo.corpora.list())[0]?.protocol[0]).toMatchObject({
    version: 1,
    body: { researchQuestion: 'Why?' },
  });
});
it('saves a changed bank link in a new protocol version', async () => {
  const example = exampleCorpus();
  const bank = { release: '2031.02.1', journalId: 'jr.synthetic', articleTypeIds: ['art.synthetic'] };
  const body = {
    venues: [{ name: 'Synthetic Journal', issn: [], openalexSourceId: 'S12345' }],
    articleTypes: ['Synthetic article'],
    years: [],
    versionOfRecordOnly: true,
    samplingRule: '',
    sampling: { scope: 'signature' },
    seed: '',
    strata: [],
    capPerIssue: null,
    exclusions: [],
    bank,
  };
  const first = { version: 1, createdAt: example.createdAt, body };
  const corpus = CorpusSchema.parse({ ...example, kind: 'journal', members: [], protocol: [first] });
  const { repo, mount } = setup(`/corpus/${corpus.id}`);
  await repo.corpora.save(corpus);
  mount();
  const [edit] = await screen.findAllByRole('button', { name: 'Sửa giao thức' });
  if (!edit) throw new Error('missing protocol edit button');
  fireEvent.click(edit);
  fireEvent.change(screen.getByLabelText('Loại bài (mỗi dòng một loại)'), {
    target: { value: 'Manual article' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu phiên bản mới' }));
  await screen.findByRole('heading', { name: 'Giao thức v2' });
  await waitFor(async () => {
    const saved = await repo.corpora.get(corpus.id);
    expect(saved?.protocol[0]).toEqual(first);
    expect(saved?.protocol[1]).toMatchObject({
      version: 2,
      body: { articleTypes: ['Manual article'], bank: { release: bank.release, journalId: bank.journalId } },
    });
    expect(saved?.protocol[1]?.body).not.toHaveProperty('bank.articleTypeIds');
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
  await screen.findByText(/, 1 bài$/);
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
  const member = corpus.members[0];
  if (!member) throw new Error('missing member');
  member.role = 'held_out';
  member.version = 'acceptedVersion';
  const { repo, mount } = setup(`/corpus/${corpus.id}`);
  await repo.corpora.save(corpus);
  mount();
  expect(await screen.findByRole('cell', { name: 'Đang tìm' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Siêu dữ liệu' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Giữ riêng kiểm tra' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Bản chấp nhận' })).toBeInTheDocument();
});
it('C3 lists and opens a corpus on the lab store, then shows a conflict with reload after another write', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const corpus = exampleCorpus();
  const worker = testWorkerData();
  const db = createDb(`corpus-remote-${crypto.randomUUID()}`);
  const repo = createRepositories(
    db,
    undefined,
    undefined,
    new CompositeDocStore(new DexieDocStore(db), worker.connect()),
  );
  const other = createRepositories(
    createDb(`corpus-other-${crypto.randomUUID()}`),
    undefined,
    undefined,
    worker.connect(),
  );
  try {
    await repo.corpora.save(corpus);
    // The corpus is on the lab store, not in this browser.
    expect(await db.corpora.count()).toBe(0);
    render(
      <MemoryRouter initialEntries={['/corpus']}>
        <StorageProvider repositories={repo}>
          <LlmProvider innerClient={client}>
            <Routes>
              <Route path="/corpus" element={<Page />} />
              <Route path="/corpus/:id" element={<DetailPage />} />
            </Routes>
          </LlmProvider>
        </StorageProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: `Thao tác với ${corpus.title}` }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mở' }));
    await screen.findByRole('heading', { name: corpus.title });
    await other.corpora.save({ ...corpus, title: 'Edited elsewhere' });
    fireEvent.click(screen.getByRole('button', { name: 'Phát hành' }));
    expect(await screen.findByText(/Corpus đã được người khác sửa/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Giữ bản của tôi' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tải bản mới' }));
    expect(await screen.findByRole('heading', { name: 'Edited elsewhere' })).toBeInTheDocument();
    expect(screen.queryByText(/Corpus đã được người khác sửa/)).toBeNull();
    expect((await other.corpora.get(corpus.id))?.protocol).toHaveLength(corpus.protocol.length);
    expect((await other.corpora.get(corpus.id))?.releases).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Phát hành' }));
    await waitFor(async () => expect((await other.corpora.get(corpus.id))?.releases).toHaveLength(1));
  } finally {
    vi.unstubAllGlobals();
  }
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
