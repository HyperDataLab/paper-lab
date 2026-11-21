import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthContext } from '@/shared/auth/authContext';
import { resetAdminCache } from '@/shared/auth/useAdmin';
import { PDF_WORKER_URL } from '@/shared/pdfStore';
import { LabAccountCard } from './LabAccountCard';

const projectId = 'rh-test-project';
vi.mock('@/shared/storage/StorageProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/storage/StorageProvider')>()),
  useHubProjectId: () => 'rh-test-project',
}));

const user = { uid: 'lab-member', email: 'member@hyperdatalab.org', name: null };
const route = '/v1/data/admin/import-legacy-corpora';
/** The worker path after PDF_WORKER_URL, which is a same-origin proxy path in dev and tests. */
const workerPath = (url: URL) =>
  url.pathname.slice(new URL(PDF_WORKER_URL, url).pathname.replace(/\/$/u, '').length);

function setup(admin: boolean) {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), window.location.origin);
    if (url.searchParams.get('projectId') !== projectId) throw new Error('Missing project scope');
    if (workerPath(url) === '/v1/me') return Response.json({ email: user.email, admin });
    if (workerPath(url) !== route) throw new Error('Unexpected route');
    return url.searchParams.has('cursor')
      ? Response.json({ imported: 4, skipped: 1, failed: 2, cursor: null })
      : Response.json({ imported: 2, skipped: 2, failed: 0, cursor: 'next+page=' });
  });
  render(
    <AuthContext.Provider
      value={{
        user,
        ready: true,
        error: '',
        getIdToken: async () => 'lab-token',
        signIn: async () => {},
        signOut: async () => {},
      }}
    >
      <LabAccountCard />
    </AuthContext.Provider>,
  );
  return fetchMock;
}

afterEach(() => {
  resetAdminCache();
  vi.restoreAllMocks();
});

it('does not show the import action to a non-admin', async () => {
  const fetchMock = setup(false);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button', { name: 'Nhập corpus cũ' })).toBeNull();
});

it('imports all pages for an admin and shows the cumulative counts', async () => {
  const fetchMock = setup(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Nhập corpus cũ' }));
  expect(await screen.findByText('Đã nhập 6, bỏ qua 3, lỗi 2.')).toBeInTheDocument();
  const imports = fetchMock.mock.calls
    .map(([input, init]) => ({ url: new URL(String(input), window.location.origin), init }))
    .filter(({ url }) => workerPath(url) === route);
  expect(imports.map(({ url, init }) => [url.searchParams.get('cursor'), init?.method])).toEqual([
    [null, 'POST'],
    ['next+page=', 'POST'],
  ]);
});
