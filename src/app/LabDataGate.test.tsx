import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { StorageProvider, useRepositories } from '@/shared/storage/StorageProvider';
import { LabDataGate } from './LabDataGate';

const auth = (signedIn: boolean, ready = true): AuthValue => ({
  user: signedIn ? { uid: 'u1', email: 'member@hyperdatalab.org', name: null } : null,
  ready,
  error: '',
  signIn: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
  getIdToken: vi.fn(async () => (signedIn ? 'token' : null)),
});

/** A data screen: it reads the repositories as soon as it mounts. */
function DataScreen() {
  const repo = useRepositories();
  void repo.papers.listSummaries();
  return <h1>Dữ liệu lab</h1>;
}

function mount(value: AuthValue) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={value}>
        <StorageProvider>
          <LabDataGate>
            <DataScreen />
          </LabDataGate>
        </StorageProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

it('C4 signed out, a data screen asks for the lab sign-in and never mounts, reads or writes', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const indexedDb = vi.fn();
  vi.stubGlobal('indexedDB', { open: indexedDb });
  const value = auth(false);
  mount(value);
  expect(screen.getByRole('heading', { name: 'Cần đăng nhập lab' })).toBeInTheDocument();
  expect(screen.getByText(/Đăng nhập bằng tài khoản lab/)).toBeInTheDocument();
  screen.getByRole('button', { name: 'Đăng nhập lab' }).click();
  expect(value.signIn).toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Dữ liệu lab' })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(indexedDb).not.toHaveBeenCalled();
});

it('C4 waits for the account check before deciding', () => {
  mount(auth(false, false));
  expect(screen.getByText('Đang kiểm tra tài khoản lab…')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Cần đăng nhập lab' })).toBeNull();
});

it('C4 signed in, the data screen mounts over the lab store', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ items: [], nextCursor: null })),
  );
  mount(auth(true));
  expect(screen.getByRole('heading', { name: 'Dữ liệu lab' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Cần đăng nhập lab' })).toBeNull();
});
