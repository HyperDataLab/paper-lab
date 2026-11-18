import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SciAtlasAnchors } from '@/core/openkg';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { RelatedPapersPanel } from './RelatedPapersPanel';

const signedIn: AuthValue = {
  user: { uid: 'u-1', email: 'tester@example.test', name: null },
  ready: true,
  error: '',
  signIn: async () => {},
  signOut: async () => {},
  getIdToken: async () => 'test-token',
};
const anchors: SciAtlasAnchors = {
  keywords: [
    { text: 'synthetic graphs', level: 'high' },
    { text: 'synthetic retrieval', level: 'middle' },
  ],
  titles: [{ title: 'A synthetic paper', level: 'high' }],
  references: ['A synthetic reference'],
  years: { from: 2015, to: 2025 },
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const zero = { pending: 0, processing: 0, done: 0, failed: 0 };
const counts = (names: string[]) => Object.fromEntries(names.map((name) => [name, 0]));
const stats = {
  nodes: {
    ...counts(['author', 'institution', 'source', 'topic', 'subfield', 'field', 'domain', 'contribution']),
    paper: 12,
    keyword: 30,
  },
  edges: counts([
    'has_keyword',
    'cites',
    'related_to',
    'authored',
    'affiliated',
    'coauthor',
    'cooccur',
    'has_topic',
    'subfield_of',
    'field_of',
    'domain_of',
    'builds_on',
  ]),
  queue: { ...zero, pending: 2, processing: 1 },
};
const papers = [
  {
    rank: 1,
    title: 'Held synthetic paper',
    year: 2021,
    score: 0.91234,
    citations: 7,
    venue: 'Synthetic Journal',
    authors: [],
    id: 'W1',
    doi: '10.1000/held',
    openalexId: 'W1',
  },
  {
    rank: 2,
    title: 'New synthetic paper',
    year: null,
    score: null,
    citations: null,
    venue: null,
    authors: [],
    id: 'W9',
    openalexId: 'W9',
  },
];

type Route = (init: RequestInit) => Response;
/** A fetch mock answering by path suffix; stats answer by default. */
function mockWorker(routes: Record<string, Route>) {
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const all: Record<string, Route> = { '/v1/kg/stats': () => json(200, stats), ...routes };
    const route = Object.entries(all).find(([suffix]) => url.endsWith(suffix));
    return route ? route[1](init) : json(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetcher);
  const calls = (suffix: string) =>
    (fetcher.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url.endsWith(suffix));
  return { fetcher, calls };
}

function show(props: Partial<Parameters<typeof RelatedPapersPanel>[0]> = {}, auth: AuthValue = signedIn) {
  return render(
    <AuthContext.Provider value={auth}>
      <RelatedPapersPanel anchors={anchors} {...props} />
    </AuthContext.Provider>,
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('L3 related papers panel (lab KG)', () => {
  it('L3 searches the lab KG by default with the edited anchors and shows KG stats', async () => {
    const { calls } = mockWorker({ '/v1/kg/search': () => json(200, { papers: [], elapsedMs: 3 }) });
    show();
    expect(screen.getByRole('heading', { name: 'Bài liên quan (KG của lab)' })).toBeInTheDocument();
    expect(await screen.findByText(/12 bài · 30 keyword · 3 đang chờ đưa vào/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ keyword synthetic retrieval' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ reference A synthetic reference' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Mức của keyword synthetic graphs' }));
    fireEvent.click(screen.getByRole('option', { name: 'Thấp' }));
    fireEvent.click(screen.getByRole('radio', { name: '20' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    expect(
      await screen.findByText('KG của lab chưa có bài nào khớp với các anchor này.'),
    ).toBeInTheDocument();
    expect(calls('/v1/sciatlas/search')).toHaveLength(0);
    const [[, init] = []] = calls('/v1/kg/search');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    expect(JSON.parse(String(init?.body))).toEqual({
      keywords: [{ text: 'synthetic graphs', level: 'low' }],
      titles: [{ title: 'A synthetic paper', level: 'high' }],
      references: [],
      after: '2015-01-01',
      before: '2025-12-31',
      topK: 20,
      ranking: 'balanced',
    });
  });

  it('L3 explains an empty KG', async () => {
    mockWorker({ '/v1/kg/search': () => json(200, { papers: [], elapsedMs: 1, hint: 'kg_empty' }) });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    expect(await screen.findByText(/KG của lab chưa có bài nào\. Hãy đưa bài vào KG/u)).toBeInTheDocument();
  });

  it('L3 takes rebuilt anchors until the user edits them', () => {
    mockWorker({});
    const view = show();
    const next = { ...anchors, keywords: [{ text: 'rebuilt keyword', level: 'high' as const }] };
    const wrap = (value: SciAtlasAnchors) => (
      <AuthContext.Provider value={signedIn}>
        <RelatedPapersPanel anchors={value} />
      </AuthContext.Provider>
    );
    view.rerender(wrap(next));
    expect(screen.getByText('rebuilt keyword')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ title A synthetic paper' }));
    view.rerender(wrap({ ...next, keywords: [{ text: 'later keyword', level: 'high' }] }));
    expect(screen.getByText('rebuilt keyword')).toBeInTheDocument();
    expect(screen.queryByText('later keyword')).toBeNull();
    expect(screen.queryByText('A synthetic paper')).toBeNull();
  });

  it('L3 disables both searches without a keyword or title', () => {
    mockWorker({});
    show({ anchors: { keywords: [], titles: [], references: [], years: null } });
    expect(screen.getByRole('button', { name: 'Tìm' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tìm thêm id từ SciAtlas' })).toBeDisabled();
    expect(screen.getByText('Cần ít nhất một keyword hoặc title để tìm.')).toBeInTheDocument();
  });

  it('L3 renders KG results with links, the held mark and an add action', async () => {
    mockWorker({ '/v1/kg/search': () => json(200, { papers, elapsedMs: 5 }) });
    const onAdd = vi.fn(async () => {});
    show({
      known: (paper) => (paper.doi === '10.1000/held' ? 'Đã có trong corpus' : undefined),
      onAdd,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    const list = await screen.findByRole('list', { name: 'Bài liên quan (KG của lab)' });
    const [held, fresh] = within(list).getAllByRole('listitem');
    if (!held || !fresh) throw new Error('missing results');
    expect(held).toHaveTextContent('2021 · Synthetic Journal · 7 trích dẫn · score 0.912');
    expect(within(held).getByText('Đã có trong corpus')).toBeInTheDocument();
    expect(within(held).getByRole('link', { name: 'DOI 10.1000/held' })).toHaveAttribute(
      'href',
      'https://doi.org/10.1000/held',
    );
    expect(within(fresh).getByRole('link', { name: 'OpenAlex W9' })).toHaveAttribute(
      'href',
      'https://openalex.org/W9',
    );
    // Without a DOI there is nothing the add-by-DOI path can take.
    expect(within(fresh).queryByRole('button', { name: 'Thêm vào corpus' })).toBeNull();
  });

  it('L3 adds a result by DOI and marks it added', async () => {
    const fresh = { ...papers[0], title: 'Fresh synthetic paper', doi: '10.1000/fresh' };
    mockWorker({ '/v1/kg/search': () => json(200, { papers: [fresh], elapsedMs: 5 }) });
    const onAdd = vi.fn(async () => {});
    show({ onAdd });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào corpus' }));
    expect(await screen.findByText('Đã thêm vào corpus')).toBeInTheDocument();
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ doi: '10.1000/fresh' }));
  });

  it('L3 pointer mode sends only SciAtlas ids to the KG ingest queue and shows none of its records', async () => {
    const pointerPaper = (title: string, ids: { doi?: string; openalexId?: string }) => ({
      rank: 1,
      title,
      year: 2020,
      score: 0.5,
      citations: 3,
      venue: 'Pointer Venue',
      authors: ['Pointer Author'],
      id: null,
      abstract: 'Pointer abstract',
      ...ids,
    });
    const { calls } = mockWorker({
      '/v1/sciatlas/search': () =>
        json(200, {
          elapsedMs: 9,
          papers: [
            pointerPaper('Pointer title one', { doi: '10.1000/p1', openalexId: 'W77' }),
            pointerPaper('Pointer title two', { doi: '10.1000/p2' }),
            pointerPaper('Pointer title three', {}),
          ],
        }),
      '/v1/kg/ingest': () => json(202, { queued: 2, processed: 0, skipped: 0, errors: [] }),
    });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Tìm thêm id từ SciAtlas' }));
    expect(
      await screen.findByText('SciAtlas gợi ý 2 id · Đã xếp vào KG 2 · Bỏ qua 0 · Lỗi 0'),
    ).toBeInTheDocument();
    const [[, init] = []] = calls('/v1/kg/ingest');
    expect(JSON.parse(String(init?.body))).toEqual({
      ids: ['W77', '10.1000/p2'],
      source: 'sciatlas_pointer',
      depth: 0,
    });
    expect(calls('/v1/kg/search')).toHaveLength(0);
    for (const text of ['Pointer title', 'Pointer Venue', 'Pointer Author', 'Pointer abstract'])
      expect(screen.queryByText(new RegExp(text, 'u'))).toBeNull();
    expect(screen.queryByRole('list', { name: 'Bài liên quan (KG của lab)' })).toBeNull();
    // Stats reload after the ids are queued.
    await waitFor(() => expect(calls('/v1/kg/stats').length).toBeGreaterThan(1));
  });

  it.each([
    [503, 'sciatlas_not_configured', 'Chủ dự án cần đặt secret SCIATLAS_API_KEY cho worker'],
    [429, 'sciatlas_quota', 'Đã dùng hết lượt tra cứu SciAtlas trong ngày'],
  ])('L3 pointer mode shows a Vietnamese message for SciAtlas %i %s', async (status, error, message) => {
    const { calls } = mockWorker({ '/v1/sciatlas/search': () => json(status, { error, message: 'detail' }) });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Tìm thêm id từ SciAtlas' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(calls('/v1/kg/ingest')).toHaveLength(0);
  });

  it.each([
    [503, 'kg_not_configured', 'KG của lab chưa được cấu hình'],
    [401, 'unauthenticated', 'Phiên đăng nhập đã hết hạn'],
    [502, 'kg_error', 'Yêu cầu tới KG của lab gặp lỗi'],
  ])('L3 shows a Vietnamese message for KG %i %s', async (status, error, message) => {
    mockWorker({ '/v1/kg/search': () => json(status, { error, message: 'detail' }) });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('L3 asks to sign in when there is no lab token', async () => {
    const { fetcher } = mockWorker({});
    show({}, { ...signedIn, user: null, getIdToken: async () => null });
    expect(screen.getByText('KG của lab · Cần đăng nhập')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Hãy đăng nhập bằng tài khoản lab'),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
