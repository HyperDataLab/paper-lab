import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exampleScgRun } from '@/core/scg/contract';
import { scgBodyEtag, projectScgPaper } from '@/core/scg/publish';
import type { Paper, ScgPaperRun } from '@/core/schemas';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { PublishScg } from './PublishScg';

const auth: AuthValue = {
  user: { uid: 'u', email: 'test@example.org', name: null },
  ready: true,
  error: '',
  signIn: async () => {},
  signOut: async () => {},
  getIdToken: async () => 'test-token',
};
const sha = 'a'.repeat(64);
const paper = {
  id: '00000000-0000-4000-8000-000000000001',
  source: { kind: 'pdf', fileName: 'a.pdf', pageCount: 1, sha256: `sha256:${sha}` },
} as Paper;
const graph = () => projectScgPaper(exampleScgRun(), `sha256-${sha}`);
const button = () => screen.getByRole('button', { name: 'Công bố đồ thị contribution' });
function setup(run: ScgPaperRun = exampleScgRun(), signedIn = true) {
  render(
    <AuthContext.Provider value={{ ...auth, user: signedIn ? auth.user : null }}>
      <PublishScg paper={paper} run={run} busy={false} />
    </AuthContext.Provider>,
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('publishing a contribution graph', () => {
  it('is disabled and sends nothing when signed out', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setup(exampleScgRun(), false);
    expect(button()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Đăng nhập tài khoản lab');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is disabled for an unfinished run', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setup({ ...exampleScgRun(), status: 'alignment' });
    expect(button()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Chạy xong ba giai đoạn');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays disabled while the paper model is not published', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'paper_not_published', message: 'x' }, { status: 404 })),
    );
    setup();
    expect(await screen.findByText(/Cần công bố paper model/u)).toBeInTheDocument();
    expect(button()).toBeDisabled();
  });

  it('shows a published graph as current or outdated by ETag', async () => {
    const etag = await scgBodyEtag(JSON.stringify(graph()));
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('If-None-Match')).toBe(`"${etag}"`);
      return new Response('{}', { status: 200, headers: { ETag: `"${'b'.repeat(64)}"` } });
    });
    vi.stubGlobal('fetch', fetchMock);
    setup();
    expect(await screen.findByText(/Bản đã công bố đã cũ/u)).toBeInTheDocument();
    expect(button()).toBeEnabled();
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`/v1/papers/sha256-${sha}/scg`);
  });

  it('shows a published graph as current when the worker answers 304', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 304 })),
    );
    setup();
    expect(await screen.findByText('Đã công bố, khớp với bản hiện tại.')).toBeInTheDocument();
    expect(button()).toBeDisabled();
  });

  it('publishes without rejected items and then shows it as current', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: 'not_found', message: 'x' }, { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({
          paperId: `sha256-${sha}`,
          etag: 'c'.repeat(64),
          updatedAt: '2026-11-18T00:00:00.000Z',
          unchanged: false,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    setup();
    expect(await screen.findByText('Đồ thị contribution chưa được công bố.')).toBeInTheDocument();
    fireEvent.click(button());
    expect(await screen.findByText('Đã công bố, khớp với bản hiện tại.')).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual(graph());
    await waitFor(() => expect(button()).toBeDisabled());
  });
});
