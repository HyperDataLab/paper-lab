import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SciAtlasAnchors } from '@/core/openkg';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { SciAtlasPanel } from './SciAtlasPanel';

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
const papers = [
  {
    rank: 1,
    title: 'Held synthetic paper',
    year: 2021,
    score: 0.91234,
    citations: 7,
    venue: 'Synthetic Journal',
    authors: [],
    id: 'x',
    doi: '10.1000/held',
  },
  {
    rank: 2,
    title: 'New synthetic paper',
    year: null,
    score: null,
    citations: null,
    venue: null,
    authors: [],
    id: null,
    openalexId: 'W9',
  },
];

function show(props: Partial<Parameters<typeof SciAtlasPanel>[0]> = {}, auth: AuthValue = signedIn) {
  return render(
    <AuthContext.Provider value={auth}>
      <SciAtlasPanel anchors={anchors} {...props} />
    </AuthContext.Provider>,
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('K4 SciAtlas panel', () => {
  it('K4 lets the user edit anchors and sends only what remains', async () => {
    const fetcher = vi.fn(async () => json(200, { papers: [], elapsedMs: 3 }));
    vi.stubGlobal('fetch', fetcher);
    show();
    expect(screen.getByText('Kết quả từ SciAtlas (OpenKG), không lưu lại.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ keyword synthetic retrieval' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ reference A synthetic reference' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Mức của keyword synthetic graphs' }));
    fireEvent.click(screen.getByRole('option', { name: 'Thấp' }));
    fireEvent.click(screen.getByRole('radio', { name: '20' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    expect(await screen.findByText('SciAtlas không trả về bài nào cho các anchor này.')).toBeInTheDocument();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/sciatlas\/search$/u);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    expect(JSON.parse(String(init.body))).toEqual({
      keywords: [{ text: 'synthetic graphs', level: 'low' }],
      titles: [{ title: 'A synthetic paper', level: 'high' }],
      references: [],
      after: '2015-01-01',
      before: '2025-12-31',
      topK: 20,
      ranking: 'balanced',
    });
  });

  it('K4 takes rebuilt anchors until the user edits them', () => {
    const view = show();
    const next = { ...anchors, keywords: [{ text: 'rebuilt keyword', level: 'high' as const }] };
    const wrap = (value: SciAtlasAnchors) => (
      <AuthContext.Provider value={signedIn}>
        <SciAtlasPanel anchors={value} />
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

  it('K4 disables search without a keyword or title', () => {
    show({ anchors: { keywords: [], titles: [], references: [], years: null } });
    expect(screen.getByRole('button', { name: 'Tìm' })).toBeDisabled();
    expect(screen.getByText('Cần ít nhất một keyword hoặc title để tìm.')).toBeInTheDocument();
  });

  it('K4 renders results with links, the held mark and an add action', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { papers, elapsedMs: 5 })),
    );
    const onAdd = vi.fn(async () => {});
    show({
      known: (paper) => (paper.doi === '10.1000/held' ? 'Đã có trong corpus' : undefined),
      onAdd,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    const list = await screen.findByRole('list', { name: 'Bài liên quan theo SciAtlas' });
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

  it('K4 adds a result by DOI and marks it added', async () => {
    const fresh = { ...papers[0], title: 'Fresh synthetic paper', doi: '10.1000/fresh' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { papers: [fresh], elapsedMs: 5 })),
    );
    const onAdd = vi.fn(async () => {});
    show({ onAdd });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào corpus' }));
    expect(await screen.findByText('Đã thêm vào corpus')).toBeInTheDocument();
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ doi: '10.1000/fresh' }));
  });

  it.each([
    [503, 'sciatlas_not_configured', 'Chủ dự án cần đặt secret SCIATLAS_API_KEY cho worker'],
    [502, 'sciatlas_auth', 'SciAtlas từ chối token của lab'],
    [429, 'sciatlas_quota', 'Đã dùng hết lượt tra cứu SciAtlas trong ngày'],
    [504, 'sciatlas_timeout', 'SciAtlas phản hồi quá lâu'],
    [502, 'sciatlas_error', 'SciAtlas đang gặp lỗi'],
    [401, 'unauthenticated', 'Phiên đăng nhập đã hết hạn'],
  ])('K4 shows a Vietnamese message for %i %s', async (status, error, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(status, { error, message: 'detail' })),
    );
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('K4 asks to sign in when there is no lab token', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    show({}, { ...signedIn, user: null, getIdToken: async () => null });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Hãy đăng nhập bằng tài khoản lab'),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
