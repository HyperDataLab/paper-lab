import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { CorpusTopics } from './CorpusTopics';

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
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') return Response.json({ jobId: 'job' }, { status: 202 });
    if (String(_url).endsWith('/run/job'))
      return Response.json({ state: 'failed', progress: 'Embedding', error: 'test stop' });
    return new Response(null, { status: 404 });
  });
  const repo = createRepositories(createDb(`topics-run-${crypto.randomUUID()}`));
  const view = render(
    <StorageProvider repositories={repo}>
      <CorpusTopics corpus={exampleCorpus()} onData={() => {}} />
    </StorageProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tính chủ đề trên máy chủ' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Embedding');
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/topics/run'),
    expect.objectContaining({ method: 'POST' }),
  );
  view.unmount();
  fetchMock.mockRestore();
  mocks.user = null;
});

it('shows an empty state and reviews a stored snapshot and AI candidate', async () => {
  const corpus = exampleCorpus();
  const repo = createRepositories(createDb(`topics-ui-${crypto.randomUUID()}`));
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
    ],
    members: [
      {
        corpusId: corpus.id,
        memberId: 'member',
        topicId: 0,
        probability: 0.2,
        weak: true,
        keyphrases: ['phrase'],
        textUsed: 'abstract',
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
  await waitFor(async () =>
    expect(await repo.corpusTopics.names('run')).toMatchObject([
      { promptVersion: 'corpus-topic-name-1', candidateName: 'Tên / Name' },
    ]),
  );
  fireEvent.click(screen.getByRole('button', { name: 'synthetic word' }));
  expect(screen.getByText(/gán yếu/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tên'), { target: { value: 'Edited' } });
  fireEvent.click(screen.getByRole('button', { name: /Chấp nhận/ }));
  await waitFor(async () => expect(await repo.corpusTopics.names('run')).toMatchObject([{ name: 'Edited' }]));
});
