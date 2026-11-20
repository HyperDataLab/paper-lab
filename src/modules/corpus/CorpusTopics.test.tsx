import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { CorpusTopics } from './CorpusTopics';
import { testRepositories } from '@/shared/storage/testRepositories';

const mocks = vi.hoisted(() => ({
  consent: vi.fn(),
  complete: vi.fn(),
  token: vi.fn(),
  user: null as object | null,
}));
vi.mock('@/shared/llm/LlmProvider', () => ({
  useLlm: () => ({ ensureConsent: mocks.consent, client: { completeJson: mocks.complete } }),
}));
vi.mock('@/shared/auth/authContext', () => ({
  useAuth: () => ({ user: mocks.user, getIdToken: mocks.token }),
}));

it('starts a server job and shows its progress', async () => {
  mocks.user = {};
  mocks.token.mockResolvedValue('token');
  let polls = 0;
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') return Response.json({ jobId: 'job' }, { status: 202 });
    if (String(_url).endsWith('/run/job')) {
      if (polls++ === 0) throw new TypeError('temporary');
      return Response.json({ state: 'failed', progress: 'Embedding', error: 'test stop' });
    }
    return new Response(null, { status: 404 });
  });
  const repo = testRepositories();
  const view = render(
    <StorageProvider repositories={repo}>
      <CorpusTopics corpus={exampleCorpus()} onData={() => {}} />
    </StorageProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tính chủ đề trên máy chủ' }));
  expect(await screen.findByRole('status')).toHaveTextContent('?ang th? l?i');
  expect(await screen.findByText(/test stop/, {}, { timeout: 15000 })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Embedding');
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/topics/run'),
    expect.objectContaining({ method: 'POST' }),
  );
  view.unmount();
  fetchMock.mockRestore();
  mocks.user = null;
}, 20000);

it('shows an empty state and reviews a stored snapshot and AI candidate', async () => {
  const corpus = exampleCorpus();
  const repo = testRepositories();
  const mount = () =>
    render(
      <StorageProvider repositories={repo}>
        <CorpusTopics corpus={corpus} onData={() => {}} />
      </StorageProvider>,
    );
  const first = mount();
  expect(await screen.findByText(/Chưa có snapshot/)).toBeInTheDocument();
  first.unmount();
  await repo.corpusTopics.save({
    format: 'paperlab-corpus-topics',
    schemaVersion: 1,
    snapshotId: 'run',
    createdAt: '2026-01-01T00:00:00Z',
    corpora: [{ corpusId: corpus.id, kind: 'journal', title: 'Synthetic' }],
    pipeline: {
      tag: 'synthetic-pipeline',
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
        words: ['synthetic word'],
        representativeMemberIds: [],
        openalexSubfields: [{ name: 'Test field', count: 1 }],
      },
      {
        topicId: 1,
        size: 0,
        byCorpus: {},
        words: ['second topic'],
        representativeMemberIds: [],
        openalexSubfields: [],
      },
    ],
    members: [
      {
        corpusId: corpus.id,
        memberId: 'member',
        topicId: 0,
        probability: 0.2,
        weak: true,
        fit: 0.1234,
        weakReason: 'low-fit',
        keyphrases: ['phrase'],
        textUsed: 'abstract',
      },
      {
        corpusId: corpus.id,
        memberId: 'other',
        topicId: 0,
        probability: 0.5,
        weak: true,
        fit: 0.3,
        weakReason: 'closer-to-other-topic',
        keyphrases: [],
        textUsed: 'title-only',
      },
      {
        corpusId: corpus.id,
        memberId: 'unassigned',
        topicId: -1,
        probability: null,
        weak: true,
        fit: null,
        weakReason: 'unassigned',
        keyphrases: [],
        textUsed: 'none',
      },
    ],
  });
  mocks.consent.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  mocks.complete.mockResolvedValue({ data: { name: 'Tên / Name', description: 'Description' } });
  mount();
  expect(await screen.findByText(/synthetic-pipeline/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Đặt tên chủ đề bằng AI' }));
  expect(mocks.complete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Đặt tên chủ đề bằng AI' }));
  await waitFor(async () => expect(await repo.corpusTopics.names('run')).toHaveLength(2));
  fireEvent.click(screen.getByRole('button', { name: 'synthetic word' }));
  expect(screen.getAllByText(/gán yếu/)).toHaveLength(2);
  expect(screen.getByText(/Độ khớp thấp/)).toHaveTextContent('Độ khớp 0.1234');
  expect(screen.getByText(/Gần chủ đề khác hơn/)).toBeInTheDocument();
  expect(
    mocks.complete.mock.calls.some(([args]) => JSON.parse(args.user).keyphrases.includes('phrase')),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Chấp nhận tất cả đề xuất' }));
  await waitFor(async () =>
    expect(
      (await repo.corpusTopics.names('run')).every(
        (name) =>
          name.name === 'Tên / Name' &&
          name.description === 'Description' &&
          name.promptVersion === 'corpus-topic-name-2',
      ),
    ).toBe(true),
  );
  fireEvent.change(screen.getByLabelText('Tên'), { target: { value: 'Edited' } });
  fireEvent.click(screen.getByRole('button', { name: 'Chấp nhận / lưu chỉnh sửa' }));
  await waitFor(async () =>
    expect((await repo.corpusTopics.names('run')).find((name) => name.topicId === 0)?.name).toBe('Edited'),
  );
  mocks.consent.mockResolvedValue(true);
  mocks.complete
    .mockRejectedValueOnce(new Error('failure'))
    .mockResolvedValueOnce({ data: { name: 'New', description: 'New description' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đặt tên chủ đề bằng AI' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Không đặt tên được 1 chủ đề');
  expect(screen.getByRole('status')).toHaveTextContent('Đặt tên 2/2');
  expect((await repo.corpusTopics.names('run')).find((name) => name.topicId === 1)).toMatchObject({
    candidateName: 'New',
    name: 'Tên / Name',
  });
});
