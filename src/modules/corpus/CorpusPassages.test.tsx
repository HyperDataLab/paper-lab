import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import type { Corpus } from '@/core/schemas/corpus';
import { CorpusPassages } from './CorpusPassages';

const PROJECT = '00000000-0000-4000-8000-000000000101';
const PAPER = '00000000-0000-4000-8000-0000000000a1';
const mocks = vi.hoisted(() => ({ token: vi.fn(), user: null as object | null }));
vi.mock('@/shared/auth/authContext', () => ({
  useAuth: () => ({ user: mocks.user, getIdToken: mocks.token }),
}));
vi.mock('@/shared/storage/StorageProvider', () => ({ useHubProjectId: () => PROJECT }));

afterEach(() => {
  vi.restoreAllMocks();
  mocks.user = null;
});

function corpus(): Corpus {
  const value = exampleCorpus();
  const [member] = value.members;
  if (!member) throw new Error('Missing synthetic member');
  value.members = [{ ...member, identifiers: { ...member.identifiers, paperIds: [PAPER] } }];
  return value;
}

const status = { queue: { pending: 0, done: 1, failed: 0 }, passages: 3, papers: 1 };

it('searches the corpus passages and links each hit to its paragraph', async () => {
  mocks.user = { uid: 'u-1' };
  mocks.token.mockResolvedValue('token');
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).includes('/v1/passages/status')) return Response.json(status);
    if (String(url).includes('/v1/passages/search'))
      return Response.json({
        passages: [
          {
            paperId: PAPER,
            paperTitle: 'Asynchronous federated learning',
            paragraphId: 'p2',
            sectionRole: 'methods',
            text: 'We measure gradient staleness as the number of server updates between download and upload.',
            score: 0.032,
            sources: ['vector', 'keyword'],
          },
        ],
        truncated: false,
      });
    if (String(url).includes('/v1/passages/reindex') && init?.method === 'POST')
      return Response.json({ queued: 1, processed: 1, status }, { status: 202 });
    return new Response(null, { status: 404 });
  });
  const value = corpus();
  render(
    <MemoryRouter>
      <CorpusPassages corpus={value} />
    </MemoryRouter>,
  );
  const region = screen.getByRole('region', { name: 'Tìm đoạn văn' });
  expect(await within(region).findByText(/3 đoạn từ 1 bài/u)).toBeInTheDocument();

  fireEvent.change(within(region).getByRole('searchbox', { name: 'Câu hỏi hoặc từ khoá' }), {
    target: { value: 'which papers measure staleness' },
  });
  fireEvent.click(within(region).getByRole('button', { name: 'Tìm' }));
  const list = await within(region).findByRole('list', { name: 'Đoạn văn tìm được' });
  const link = within(list).getByRole('link', { name: 'Asynchronous federated learning' });
  expect(link).toHaveAttribute('href', `/papers/${PAPER}?p=p2`);
  expect(within(list).getByText('Methods')).toBeInTheDocument();
  expect(within(list).getByText('Khớp ngữ nghĩa · Khớp từ khoá')).toBeInTheDocument();
  const searchCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/search'));
  expect(JSON.parse(String(searchCall?.[1]?.body))).toEqual({
    query: 'which papers measure staleness',
    corpusId: value.id,
    limit: 10,
  });
  expect(new Headers(searchCall?.[1]?.headers).get('X-Project-Id')).toBe(PROJECT);

  fireEvent.click(within(region).getByRole('button', { name: 'Lập chỉ mục lại' }));
  expect(await within(region).findByRole('status')).toHaveTextContent('Đã xếp 1 bài');
  const reindexCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/reindex'));
  expect(JSON.parse(String(reindexCall?.[1]?.body))).toEqual({ corpusId: value.id });
});

it('explains an unconfigured index and asks for sign-in', async () => {
  mocks.user = { uid: 'u-1' };
  mocks.token.mockResolvedValue('token');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    String(url).includes('/status')
      ? Response.json(status)
      : Response.json({ error: 'passages_not_configured', message: 'x' }, { status: 503 }),
  );
  const view = render(
    <MemoryRouter>
      <CorpusPassages corpus={corpus()} />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByRole('searchbox', { name: 'Câu hỏi hoặc từ khoá' }), {
    target: { value: 'staleness' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('chưa được cấu hình');
  view.unmount();

  mocks.user = null;
  render(
    <MemoryRouter>
      <CorpusPassages corpus={corpus()} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText(/Cần đăng nhập/u)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Tìm' })).toBeDisabled();
});
