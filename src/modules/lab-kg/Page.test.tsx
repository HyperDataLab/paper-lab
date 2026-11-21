import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import Page from './Page';

const download = vi.hoisted(() => vi.fn());
vi.mock('@/shared/calibration/download', () => ({ downloadText: download }));
const corpora = vi.hoisted(() => ({
  list: [] as { id: string; title: string; members: { identifiers: Record<string, unknown> }[] }[],
}));
vi.mock('@/shared/storage/StorageProvider', () => {
  const repo = {
    paperContext: {
      list: async () => [{ paperId: 'local-1', paperDoi: 'https://doi.org/10.1000/CENTRE', metadata: null }],
    },
    corpora: { list: async () => corpora.list },
  };
  return { useRepositories: () => repo };
});

const signedIn: AuthValue = {
  user: { uid: 'u-1', email: 'tester@example.test', name: null },
  ready: true,
  error: '',
  signIn: async () => {},
  signOut: async () => {},
  getIdToken: async () => 'test-token',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const zeros = (names: string[]) => Object.fromEntries(names.map((name) => [name, 0]));
const stats = (papers: number) => ({
  nodes: {
    ...zeros(['author', 'institution', 'source', 'topic', 'subfield', 'field', 'domain', 'contribution']),
    paper: papers,
    keyword: papers * 2,
  },
  edges: zeros([
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
  queue: { pending: 1, processing: 0, done: 4, failed: 0 },
});
const graph = (layers: string[]) => ({
  centre: 'W1',
  depth: 1,
  layers,
  nodes: [
    {
      id: 'W1',
      kind: 'paper',
      label: 'Synthetic centre paper',
      weight: 1,
      depth: 0,
      doi: '10.1000/centre',
      year: 2021,
    },
    { id: 'keywords/synthetic-graphs', kind: 'keyword', label: 'synthetic graphs', weight: 0.9, depth: 1 },
    { id: 'W2', kind: 'paper', label: 'Synthetic cited paper', weight: 0.6, depth: 1, year: 2019 },
    ...(layers.includes('authors')
      ? [{ id: 'A1', kind: 'author', label: 'Author One', weight: 1, depth: 1 }]
      : []),
  ],
  edges: [
    { source: 'W1', target: 'keywords/synthetic-graphs', type: 'has_keyword', weight: 0.9 },
    { source: 'W1', target: 'W2', type: 'cites', weight: 0.6 },
    ...(layers.includes('authors') ? [{ source: 'W1', target: 'A1', type: 'authored', weight: 1 }] : []),
  ],
  truncated: false,
  outside: ['W9'],
});
const paperDetail = {
  paper: {
    id: 'W1',
    doi: '10.1000/centre',
    title: 'Synthetic centre paper',
    abstract: null,
    year: 2021,
    citations: 5,
    type: 'article',
    venue: { id: 'S1', name: 'Synthetic Journal' },
  },
  keywords: [{ id: 'keywords/synthetic-graphs', text: 'synthetic graphs', score: 0.9 }],
  topics: [],
  authors: [],
  cites: [{ id: 'W2', title: 'Synthetic cited paper', year: 2019 }],
  citedBy: [],
  contributions: [
    { id: 'c1', name: 'A synthetic method', description: 'Does a synthetic thing.', review: 'accepted' },
  ],
};

let paperCount = 3;
/** Per-test answers that replace the defaults below, by path. */
let overrides: Record<string, (url: URL, init?: RequestInit) => Response | Promise<Response>> = {};
const overview = {
  papers: [{ id: 'W1', title: 'Synthetic centre paper', year: 2021, citations: 5 }],
  keywords: [{ id: 'keywords/synthetic-graphs', text: 'synthetic graphs', frequency: 3 }],
};
const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
  const url = new URL(input, 'https://worker.test');
  const path = url.pathname.replace(/^.*\/v1\/kg/u, '');
  const override = overrides[path] ?? (path.startsWith('/papers/') ? overrides['/papers/'] : undefined);
  if (override) return override(url, init);
  if (path === '/stats') return json(stats(paperCount));
  if (path === '/overview') return json(overview);
  if (path === '/ingest/status')
    return json({ counts: { pending: 0, processing: 0, done: 0, failed: 0 }, logs: [] });
  if (path === '/search')
    return json({
      papers: [
        {
          rank: 1,
          title: 'Synthetic centre paper',
          year: 2021,
          score: 0.9,
          citations: 5,
          venue: 'Synthetic Journal',
          authors: [],
          id: 'W1',
          openalexId: 'W1',
        },
      ],
      elapsedMs: 3,
    });
  if (path === '/graph') return json(graph((url.searchParams.get('layers') ?? '').split(',')));
  if (path === '/trend')
    return json({
      years: [2020, 2021],
      keywords: [{ id: 'keywords/synthetic-graphs', text: 'synthetic graphs', total: 3, counts: [1, 2] }],
      missing: [],
    });
  if (path.startsWith('/papers/')) return json(paperDetail);
  if (path === '/ingest') {
    const body = JSON.parse(String(init?.body)) as { ids: string[] };
    return json({ queued: body.ids.length, processed: 0, skipped: 0, errors: [] }, 202);
  }
  return json({ error: 'not_found' }, 404);
});

beforeEach(() => {
  paperCount = 3;
  overrides = {};
  corpora.list = [];
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  fetcher.mockClear();
  download.mockClear();
  vi.unstubAllGlobals();
});

function show(auth: AuthValue = signedIn) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <LlmProvider>
          <Page />
        </LlmProvider>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}
const calls = (path: string) =>
  fetcher.mock.calls
    .map(([url]) => new URL(url, 'https://worker.test'))
    .filter(({ pathname }) => pathname.endsWith(path));

async function openCentre() {
  show();
  fireEvent.change(await screen.findByLabelText('Tìm tâm đồ thị'), { target: { value: 'synthetic graphs' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Synthetic centre paper' }));
  return screen.findByRole('group', { name: 'Đồ thị KG của lab quanh tâm đã chọn' });
}

describe('L4 lab KG explorer', () => {
  it('L4 asks to sign in when signed out', () => {
    show({ ...signedIn, user: null, getIdToken: async () => null });
    expect(screen.getByText('Cần đăng nhập')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Hỏi KG bằng câu hỏi' })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('L4 explains how to fill an empty KG and keeps search for one DOI', async () => {
    paperCount = 0;
    show();
    expect(await screen.findByText('KG của lab chưa có bài nào')).toBeTruthy();
    expect(screen.getByText(/Đưa bài này vào KG/u)).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Mở Corpus' })).toBeTruthy();
    expect(screen.getByLabelText('Tìm tâm đồ thị')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Hỏi KG bằng câu hỏi' })).toBeInTheDocument();
    expect(calls('/overview')).toHaveLength(0);
  });

  it('L4 sends a local corpus to the KG in batches from the empty state', async () => {
    paperCount = 0;
    corpora.list = [
      {
        id: 'c1',
        title: 'Synthetic corpus',
        members: [
          ...Array.from({ length: 60 }, (_, index) => ({ identifiers: { openalexId: `W${index + 1}` } })),
          { identifiers: { doi: '10.1000/extra' } },
          { identifiers: {} },
        ],
      },
    ];
    show();
    const list = await screen.findByRole('list', { name: 'Corpus trong trình duyệt này' });
    expect(within(list).getByText(/62 bài · 61 có DOI hoặc OpenAlex ID/u)).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: 'Đưa 61 bài vào KG' }));
    expect(await within(list).findByText(/Đã gửi 61\/61 \(50 bài một lượt\) · Đã xếp 61/u)).toBeTruthy();
    const bodies = fetcher.mock.calls
      .filter(([url]) => String(url).endsWith('/ingest'))
      .map(([, init]) => JSON.parse(String(init?.body)) as { ids: string[] });
    expect(bodies.map(({ ids }) => ids.length)).toEqual([50, 11]);
    expect(bodies[1]?.ids.at(-1)).toBe('10.1000/extra');
    // The counts are fetched again once the corpus is queued.
    await waitFor(() => expect(calls('/stats').length).toBeGreaterThan(1));
  });

  it('L4 shows the stats failure with its HTTP status and code, and retries', async () => {
    let fail = true;
    overrides['/stats'] = () =>
      fail ? json({ error: 'internal', message: 'An internal error occurred.' }, 500) : json(stats(3));
    show();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Máy chủ KG của lab gặp lỗi (HTTP 500).');
    expect(within(alert).getByText('HTTP 500 · internal')).toBeTruthy();
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Đang chờ đưa vào')).toBeTruthy();
  });

  it('L4 offers starting points: most cited papers and frequent keywords', async () => {
    show();
    const starts = await screen.findByRole('region', { name: 'Điểm bắt đầu' });
    expect(within(starts).getByRole('button', { name: 'synthetic graphs (3)' })).toBeTruthy();
    fireEvent.click(within(starts).getByRole('button', { name: 'Synthetic centre paper (5)' }));
    expect(await screen.findByRole('group', { name: 'Đồ thị KG của lab quanh tâm đã chọn' })).toBeTruthy();
    expect(calls('/graph')[0]?.searchParams.get('center')).toBe('W1');
  });

  it('L4 puts a paper that is not in the KG yet into it, then centres on it', async () => {
    const doi = '10.1016/j.heliyon.2024.e38137';
    let present = false;
    overrides['/graph'] = (url) =>
      present
        ? json(graph((url.searchParams.get('layers') ?? '').split(',')))
        : json({ error: 'not_found' }, 404);
    overrides['/ingest'] = () => {
      present = true;
      return json({ queued: 1, processed: 1, skipped: 0, errors: [] }, 202);
    };
    overrides['/papers/'] = () => (present ? json(paperDetail) : json({ error: 'not_found' }, 404));
    show();
    fireEvent.change(await screen.findByLabelText('Tìm tâm đồ thị'), { target: { value: doi } });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    expect(await screen.findByText('Bài này chưa có trong KG của lab')).toBeTruthy();
    expect(calls('/search')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Đưa bài này vào KG' }));
    expect(await screen.findByRole('group', { name: 'Đồ thị KG của lab quanh tâm đã chọn' })).toBeTruthy();
    const [, init] = fetcher.mock.calls.find(([url]) => String(url).endsWith('/ingest')) ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({ ids: [doi] });
    expect(calls('/graph').at(-1)?.searchParams.get('center')).toBe(doi);
    expect(screen.queryByText('Bài này chưa có trong KG của lab')).toBeNull();
  });

  it('L4 suggests a text search for a keyword that is not in the KG', async () => {
    overrides['/graph'] = () => json({ error: 'not_found' }, 404);
    show();
    fireEvent.change(await screen.findByLabelText('Tìm tâm đồ thị'), {
      target: { value: 'keywords/graph-neural-networks' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    expect(await screen.findByText('Keyword này chưa có trong KG của lab')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tìm “graph neural networks”' }));
    await waitFor(() => expect(calls('/search')).toHaveLength(1));
    const [, init] = fetcher.mock.calls.find(([url]) => String(url).endsWith('/search')) ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({ query: 'graph neural networks' });
  });

  it('L4 counts nodes per layer and hides the old graph while a new one loads', async () => {
    await openCentre();
    const layers = screen.getByRole('group', { name: 'Lớp' });
    for (const name of ['Bài báo (1)', 'Keywords (1)', 'Tác giả (1)', 'Cơ quan (0)', 'Chủ đề (0)'])
      expect(within(layers).getByRole('button', { name })).toBeTruthy();
    let release: (response: Response) => void = () => undefined;
    overrides['/graph'] = () => new Promise<Response>((resolve) => (release = resolve));
    fireEvent.click(screen.getByRole('radio', { name: '2 bước' }));
    expect(await screen.findByRole('status', { name: 'Đang tải đồ thị…' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Đồ thị KG của lab quanh tâm đã chọn' })).toBeNull();
    release(json({ ...graph(['papers', 'keywords', 'authors', 'institutions', 'topics']), depth: 2 }));
    expect(await screen.findByRole('group', { name: 'Đồ thị KG của lab quanh tâm đã chọn' })).toBeTruthy();
  });

  it('L4 shows stats, picks a centre from search and draws its neighbours', async () => {
    const svg = await openCentre();
    expect(screen.getByText('Đang chờ đưa vào')).toBeTruthy();
    const drawn = within(svg);
    for (const name of ['Synthetic centre paper', 'synthetic graphs', 'Synthetic cited paper', 'Author One'])
      expect(drawn.getByRole('button', { name })).toBeTruthy();
    expect(calls('/graph')[0]?.searchParams.get('center')).toBe('W1');
    expect(calls('/search')).toHaveLength(1);
    // Node details for the centre, with the local paper found by DOI.
    const panel = screen.getByRole('complementary', { name: 'Chi tiết nút' });
    expect(await within(panel).findByText('A synthetic method')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'Mở bài trong PaperLab' }).getAttribute('href')).toBe(
      '/papers/local-1',
    );
    expect(within(panel).getByText('References trong KG (1)')).toBeTruthy();
    // The accessible list and the keyword trend.
    expect(screen.getByText('Danh sách nút (4)')).toBeTruthy();
    expect(await screen.findByRole('table', { name: 'Số bài theo keyword và năm xuất bản' })).toBeTruthy();
    expect(calls('/trend')[0]?.searchParams.get('keywords')).toBe('keywords/synthetic-graphs');
  });

  it('L4 refetches when a layer or the depth changes', async () => {
    await openCentre();
    fireEvent.click(screen.getByRole('button', { name: 'Tác giả (1)', pressed: true }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Author One' })).toBeNull());
    expect(calls('/graph').at(-1)?.searchParams.get('layers')).toBe('papers,keywords,institutions,topics');
    fireEvent.click(screen.getByRole('radio', { name: '2 bước' }));
    await waitFor(() => expect(calls('/graph').at(-1)?.searchParams.get('depth')).toBe('2'));
  });

  it('L4 exports Turtle and JSON-LD from the loaded graph', async () => {
    await openCentre();
    fireEvent.click(screen.getByRole('button', { name: /Xuất đồ thị/u }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Turtle (.ttl)' }));
    const [name, turtle, mime] = download.mock.calls[0] as [string, string, string];
    expect(name).toBe('lab-kg-W1.ttl');
    expect(mime).toBe('text/turtle');
    expect(turtle).toContain('<https://hyperdatalab-paragraph-lab.web.app/kg/work/W1>');
    fireEvent.click(screen.getByRole('button', { name: /Xuất đồ thị/u }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'JSON-LD (.jsonld)' }));
    expect(JSON.parse((download.mock.calls[1] as [string, string])[1])).toHaveProperty('@graph');
  });

  it('L4 queues cited works that are not in the KG yet', async () => {
    await openCentre();
    fireEvent.click(screen.getByRole('button', { name: 'Đưa 1 bài được dẫn vào KG' }));
    expect(await screen.findByText(/Đã xếp 1/u)).toBeTruthy();
    const [, init] = fetcher.mock.calls.find(([url]) => String(url).endsWith('/ingest')) ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({ ids: ['W9'], source: 'expansion', depth: 0 });
  });

  it('L4 re-centres on a keyword from the node details', async () => {
    await openCentre();
    const panel = screen.getByRole('complementary', { name: 'Chi tiết nút' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'synthetic graphs' }));
    await waitFor(() =>
      expect(calls('/graph').at(-1)?.searchParams.get('center')).toBe('keywords/synthetic-graphs'),
    );
  });
});
