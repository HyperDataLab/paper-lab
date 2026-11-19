import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { examplePaperModel } from '@/core/paperModel/contract';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { PublishPaperModel } from './PublishPaperModel';
import { fixturePaper, fixtureRun } from '@/core/measurement/testFixture';
import { contentEtag } from '@/core/paperModel/published';

const storage = vi.hoisted(() => ({ measurements: { get: vi.fn() }, papers: { get: vi.fn() } }));
vi.mock('@/shared/storage/StorageProvider', () => ({ useRepositories: () => storage }));

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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

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
    expect(screen.getByRole('status')).toHaveTextContent('chưa có dữ kiện thí nghiệm');
  });
  it.each([false, true])('publishes facts after the model and reports failure=%s', async (failure) => {
    const localId = '00000000-0000-4000-8000-000000000001';
    const run = fixtureRun();
    const paper = { ...fixturePaper, id: localId };
    run.profile.paper_id = localId;
    storage.papers.get.mockResolvedValue(paper);
    storage.measurements.get.mockResolvedValue({ paperId: localId, runs: [run], decisions: [] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          paperId: localId,
          etag: 'a'.repeat(64),
          updatedAt: '2026-01-01T00:00:00.000Z',
          unchanged: false,
        }),
      )
      .mockResolvedValueOnce(
        failure
          ? new Response(null, { status: 409 })
          : Response.json({
              paperId: localId,
              etag: 'b'.repeat(64),
              updatedAt: '2026-01-01T00:00:00.000Z',
              unchanged: false,
            }),
      );
    vi.stubGlobal('fetch', fetchMock);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Công bố lên máy chủ lab' }));
    // The status line changes while publishing; wait for the final text, not the first status shown.
    await waitFor(
      () =>
        expect(screen.getByRole(failure ? 'alert' : 'status')).toHaveTextContent(
          failure ? 'Không công bố được dữ kiện thí nghiệm' : /kèm \d+ dữ kiện thí nghiệm \(\d+ đã duyệt\)/u,
        ),
      { timeout: 5000 },
    );
    if (failure) expect(screen.getByRole('alert')).toHaveTextContent('không khớp với paper model');
    expect(screen.getByText(/Đã công bố \(mã aaaaaaaa\)/u)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/experiment-facts');
    const body = JSON.parse(fetchMock.mock.calls[1]?.[1].body as string) as {
      paperId: string;
      modelEtag: string;
    };
    expect(body).toMatchObject({ paperId: localId, modelEtag: await contentEtag(model) });
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
