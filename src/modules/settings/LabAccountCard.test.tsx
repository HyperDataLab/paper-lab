import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthContext } from '@/shared/auth/authContext';
import { resetAdminCache } from '@/shared/auth/useAdmin';
import { LabAccountCard } from './LabAccountCard';

const user = { uid: 'lab-member', email: 'member@hyperdatalab.org', name: null };
const route = '/v1/data/admin/import-legacy-corpora';

function setup(admin: boolean) {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/v1/me') return Response.json({ email: user.email, admin });
    if (url.pathname !== route) throw new Error('Unexpected route');
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
    .map(([input, init]) => ({ url: new URL(String(input)), init }))
    .filter(({ url }) => url.pathname === route);
  expect(imports.map(({ url, init }) => [url.searchParams.get('cursor'), init?.method])).toEqual([
    [null, 'POST'],
    ['next+page=', 'POST'],
  ]);
});
