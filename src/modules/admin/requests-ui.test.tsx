import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '@/app/Sidebar';
import type { Paper } from '@/core/schemas';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { resetAdminCache } from '@/shared/auth/useAdmin';
import RequestsPage from './RequestsPage';

const LOCAL_SHA = 'b'.repeat(64);
const localPaper = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Local synthetic study',
  source: { kind: 'pdf', fileName: 'a.pdf', pageCount: 1, sha256: `sha256:${LOCAL_SHA}` },
} as unknown as Paper;
const storage = vi.hoisted(() => ({ papers: { list: vi.fn() } }));
vi.mock('@/shared/storage/StorageProvider', () => ({ useRepositories: () => storage }));

const base = {
  note: 'SRD needs the experiment facts',
  requestedBy: 'srd@example.org',
  requestedAt: '2026-03-01T08:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
};
const requests = [
  {
    ...base,
    paperId: `sha256-${LOCAL_SHA}`,
    state: 'requested',
    title: 'Local synthetic study',
    doi: '10.1/a',
  },
  { ...base, paperId: `sha256-${'c'.repeat(64)}`, state: 'approved', title: 'Remote study', doi: null },
  {
    ...base,
    paperId: 'p-declined',
    state: 'declined',
    title: 'Declined study',
    decidedBy: 'admin@example.org',
  },
  { ...base, paperId: 'p-done', state: 'done', title: 'Done study', decidedBy: 'admin@example.org' },
];

const user = { uid: 'u1', email: 'someone@example.org', name: null };
function auth(signedIn: boolean): AuthValue {
  return {
    user: signedIn ? user : null,
    ready: true,
    error: '',
    signIn: async () => {},
    signOut: async () => {},
    getIdToken: async () => (signedIn ? 'test-token' : null),
  };
}

function serve(admin: boolean) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/v1/me') return Response.json({ email: user.email, admin });
    if (url.pathname === '/v1/admin/fact-requests') {
      const state = url.searchParams.get('state');
      return Response.json({ items: requests.filter((item) => item.state === state), nextCursor: null });
    }
    const decided = /^\/v1\/admin\/fact-requests\/([^/]+)\/decision$/u.exec(url.pathname);
    if (decided && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { decision: string; note?: string };
      const original = requests.find((item) => item.paperId === decodeURIComponent(decided[1] ?? ''));
      // The decision route answers with the bare request: no title or DOI.
      const bare: Record<string, unknown> = { ...original };
      delete bare.title;
      delete bare.doi;
      return Response.json({
        ...bare,
        state: body.decision === 'approve' ? 'approved' : 'declined',
        decidedBy: 'admin@example.org',
        decidedAt: '2026-03-02T08:00:00.000Z',
        decisionNote: body.note ?? null,
      });
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function open(signedIn: boolean, path = '/admin/requests') {
  storage.papers.list.mockResolvedValue([localPaper]);
  render(
    <AuthContext.Provider value={auth(signedIn)}>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar />
        <Sidebar mobile />
        <Routes>
          <Route path="/admin/requests" element={<RequestsPage />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}
const calls = (fetchMock: ReturnType<typeof serve>, path: string) =>
  fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname === path);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  resetAdminCache();
});

describe('admin fact requests', () => {
  it('hides the entry and the page when signed out, without asking the server', async () => {
    const fetchMock = serve(true);
    open(false);
    expect(await screen.findByText('Chỉ quản trị viên PaperLab mới xem được trang này')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Duyệt yêu cầu/u })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides the entry for a non-admin and refuses the direct URL', async () => {
    const fetchMock = serve(false);
    open(true);
    expect(await screen.findByText('Chỉ quản trị viên PaperLab mới xem được trang này')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Duyệt yêu cầu/u })).toBeNull();
    expect(calls(fetchMock, '/v1/admin/fact-requests')).toHaveLength(0);
  });

  it('shows the entry to an admin in both sidebars after one /v1/me call', async () => {
    const fetchMock = serve(true);
    open(true, '/');
    expect(await screen.findAllByRole('link', { name: /Duyệt yêu cầu/u })).toHaveLength(2);
    expect(calls(fetchMock, '/v1/me')).toHaveLength(1);
  });

  it('lists requested by default and filters by state', async () => {
    const fetchMock = serve(true);
    open(true);
    expect(await screen.findByText('Local synthetic study')).toBeInTheDocument();
    expect(screen.getByText('SRD needs the experiment facts')).toBeInTheDocument();
    expect(screen.getByText(/DOI 10\.1\/a · Yêu cầu bởi srd@example\.org/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đang chờ' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Remote study')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Đã duyệt' }));
    expect(await screen.findByText('Remote study')).toBeInTheDocument();
    expect(screen.getByText(/không có trong thư viện PaperLab/u)).toBeInTheDocument();
    expect(screen.queryByText('Local synthetic study')).toBeNull();
    const listed = calls(fetchMock, '/v1/admin/fact-requests').map(([input]) =>
      new URL(String(input)).searchParams.get('state'),
    );
    expect(listed).toEqual(['requested', 'approved']);
    expect(calls(fetchMock, '/v1/me')).toHaveLength(1);
  });

  it('approves, then links to the local paper for measurement and publishing', async () => {
    const fetchMock = serve(true);
    open(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    const measure = await screen.findByRole('link', { name: 'Mở measurement của bài' });
    expect(measure).toHaveAttribute('href', `/papers/${localPaper.id}?view=measure`);
    expect(screen.getByRole('link', { name: 'Publication info' })).toHaveAttribute(
      'href',
      `/papers/${localPaper.id}?view=metadata`,
    );
    expect(screen.getByText(/Công bố lên máy chủ lab/u)).toBeInTheDocument();
    expect(screen.getByText('Local synthetic study')).toBeInTheDocument();
    expect(screen.getByText(/DOI 10\.1\/a/u)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull();
    const decision = calls(fetchMock, `/v1/admin/fact-requests/sha256-${LOCAL_SHA}/decision`);
    expect(decision).toHaveLength(1);
    expect(decision[0]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ decision: 'approve' }) });
  });

  it('declines only with a reason and sends it', async () => {
    const fetchMock = serve(true);
    open(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Từ chối' }));
    const send = screen.getByRole('button', { name: 'Gửi từ chối' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Lý do từ chối'), {
      target: { value: 'Not an experiment paper' },
    });
    fireEvent.click(send);
    expect(await screen.findByText(/Lý do: Not an experiment paper/u)).toBeInTheDocument();
    const decision = calls(fetchMock, `/v1/admin/fact-requests/sha256-${LOCAL_SHA}/decision`);
    expect(decision[0]?.[1]).toMatchObject({
      body: JSON.stringify({ decision: 'decline', note: 'Not an experiment paper' }),
    });
    expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull();
  });

  it.each([
    ['Đã từ chối', 'Declined study'],
    ['Đã xong', 'Done study'],
  ])('shows %s requests read-only', async (label, title) => {
    serve(true);
    open(true);
    await screen.findByText('Local synthetic study');
    fireEvent.click(screen.getByRole('button', { name: label }));
    const card = (await screen.findByText(title)).closest('section');
    expect(card).not.toBeNull();
    if (!card) return;
    expect(within(card).queryByRole('button', { name: 'Duyệt' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Từ chối' })).toBeNull();
    await waitFor(() => expect(within(card).getByText(/bởi admin@example\.org/u)).toBeInTheDocument());
  });
});
