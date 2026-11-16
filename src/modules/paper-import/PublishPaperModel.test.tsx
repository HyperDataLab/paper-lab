import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { examplePaperModel } from '@/core/paperModel/contract';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { PublishPaperModel } from './PublishPaperModel';

const auth: AuthValue = {
  user: { uid: 'u', email: 'test@example.org', name: null },
  ready: true,
  error: '',
  signIn: async () => {},
  signOut: async () => {},
  getIdToken: async () => 'test-token',
};
const model = examplePaperModel();
model.document.source.sha256 = null;
function setup(signedIn = true) {
  const buildModel = vi.fn(async () => model);
  render(
    <AuthContext.Provider value={{ ...auth, user: signedIn ? auth.user : null }}>
      <PublishPaperModel paperId="00000000-0000-4000-8000-000000000001" buildModel={buildModel} />
    </AuthContext.Provider>,
  );
  return buildModel;
}
afterEach(() => vi.unstubAllGlobals());

describe('publishing a paper model', () => {
  it('explains why publishing is disabled when signed out, without sending anything', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const buildModel = setup(false);
    expect(screen.getByRole('button', { name: 'Công bố lên máy chủ lab' })).toBeDisabled();
    expect(screen.getByText(/Đăng nhập tài khoản lab/u)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(buildModel).not.toHaveBeenCalled();
  });
  it.each([false, true])('publishes only after clicking and reports unchanged=%s', async (unchanged) => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        paperId: 'id',
        etag: 'a'.repeat(64),
        updatedAt: '2026-01-01T00:00:00.000Z',
        unchanged,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const buildModel = setup();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(buildModel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Công bố lên máy chủ lab' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      unchanged ? 'Không có thay đổi so với bản đã công bố' : 'Đã công bố (mã aaaaaaaa) lúc',
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('shows the reason for a failed publish', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 403 })),
    );
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Công bố lên máy chủ lab' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tài khoản này không được công bố');
  });
});
