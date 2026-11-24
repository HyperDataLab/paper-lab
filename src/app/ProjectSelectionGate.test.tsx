import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { listResearchHubProjects } from '@/shared/pdfStore/researchHubProjects';
import { ProjectSelectionGate } from './ProjectSelectionGate';

vi.mock('@/shared/pdfStore/researchHubProjects', () => ({ listResearchHubProjects: vi.fn() }));

const project = { id: '00000000-0000-4000-8000-000000000001', name: 'PaperLab research' };
const signedIn: AuthValue = {
  user: { uid: 'u1', email: 'researcher@hyperdatalab.org', name: 'Researcher' },
  ready: true,
  error: '',
  signIn: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
  getAccessToken: vi.fn(async () => 'access-token'),
  getIdToken: vi.fn(async () => 'access-token'),
};

function Location() {
  const { pathname, search } = useLocation();
  return <output aria-label="Đường dẫn hiện tại">{`${pathname}${search}`}</output>;
}

function Harness({ auth = signedIn }: { auth?: AuthValue }) {
  const { search } = useLocation();
  const projectId = new URLSearchParams(search).get('projectId');
  return (
    <AuthContext.Provider value={auth}>
      <ProjectSelectionGate projectId={projectId}>
        <h2>Project workspace</h2>
      </ProjectSelectionGate>
      <Location />
    </AuthContext.Provider>
  );
}

function mount(auth?: AuthValue, initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Harness auth={auth} />
    </MemoryRouter>,
  );
}

afterEach(() => vi.clearAllMocks());

it('asks for SSO and keeps project workspace unmounted before login', () => {
  const auth: AuthValue = { ...signedIn, user: null };
  mount(auth);
  expect(screen.getByRole('heading', { name: 'Đăng nhập vào PaperLab' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập SSO' }));
  expect(auth.signIn).toHaveBeenCalledOnce();
  expect(screen.queryByRole('heading', { name: 'Project workspace' })).not.toBeInTheDocument();
});

it('loads authorized projects and adds the selected project id to the current route', async () => {
  vi.mocked(listResearchHubProjects).mockResolvedValue([project]);
  mount();

  fireEvent.click(await screen.findByRole('button', { name: /PaperLab research/u }));
  expect(await screen.findByRole('heading', { name: 'Project workspace' })).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByLabelText('Đường dẫn hiện tại')).toHaveTextContent(`/?projectId=${project.id}`),
  );
  expect(listResearchHubProjects).toHaveBeenCalledWith('access-token', expect.any(AbortSignal));
});

it('shows an empty project state instead of mounting an unscoped workspace', async () => {
  vi.mocked(listResearchHubProjects).mockResolvedValue([]);
  mount();
  expect(await screen.findByText('Tài khoản chưa có project khả dụng')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Project workspace' })).not.toBeInTheDocument();
});
