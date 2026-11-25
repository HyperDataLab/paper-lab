import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { createResearchHubProject, listResearchHubProjects } from '@/shared/pdfStore/researchHubProjects';
import { ProjectSelectionGate } from './ProjectSelectionGate';

vi.mock('@/shared/pdfStore/researchHubProjects', () => ({
  createResearchHubProject: vi.fn(),
  listResearchHubProjects: vi.fn(),
}));

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

it('shows the first-project form and account email when the project list is empty', async () => {
  vi.mocked(listResearchHubProjects).mockResolvedValue([]);
  mount();
  expect(await screen.findByRole('heading', { name: 'Tạo project đầu tiên' })).toBeInTheDocument();
  expect(screen.getByText('researcher@hyperdatalab.org')).toBeInTheDocument();
  expect(
    screen.getByText('Project được lưu trong ResearchHub và mở ngay trong PaperLab.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tạo project và mở PaperLab' })).toBeDisabled();
  expect(screen.queryByRole('heading', { name: 'Project workspace' })).not.toBeInTheDocument();
});

it('creates a project and opens the returned ResearchHub workspace', async () => {
  vi.mocked(listResearchHubProjects).mockResolvedValue([]);
  vi.mocked(createResearchHubProject).mockResolvedValue(project);
  mount();

  fireEvent.change(await screen.findByLabelText('Tên project'), {
    target: { value: 'Adaptive learning review' },
  });
  fireEvent.change(screen.getByLabelText('Mô tả'), {
    target: { value: 'A focused literature review' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo project và mở PaperLab' }));

  expect(await screen.findByRole('heading', { name: 'Project workspace' })).toBeInTheDocument();
  expect(createResearchHubProject).toHaveBeenCalledWith('access-token', {
    name: 'Adaptive learning review',
    description: 'A focused literature review',
  });
  expect(screen.getByLabelText('Đường dẫn hiện tại')).toHaveTextContent(`/?projectId=${project.id}`);
});

it('shows the loading state while the authorized project list is pending', () => {
  vi.mocked(listResearchHubProjects).mockReturnValue(new Promise(() => {}));
  mount();
  expect(screen.getByRole('status', { name: 'Đang tải danh sách project…' })).toBeInTheDocument();
});

it('shows a recoverable error when the project list cannot be loaded', async () => {
  vi.mocked(listResearchHubProjects).mockRejectedValue(new Error('Worker unavailable'));
  mount();
  expect(await screen.findByText('Worker unavailable')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tải lại danh sách' })).toBeInTheDocument();
});
