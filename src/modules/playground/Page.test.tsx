import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthContext } from '@/shared/auth/authContext';
import { LabResearchError } from '@/shared/labResearch';
import Page from './Page';

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  url: 'https://lab.test',
}));
const adminState = vi.hoisted(() => ({ admin: true, checking: false }));
vi.mock('@/shared/labResearch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/labResearch')>()),
  get LAB_RESEARCH_URL() {
    return mocks.url;
  },
  createLabResearchClient: () => mocks,
}));
vi.mock('@/shared/auth/useAdmin', () => ({ useAdmin: () => adminState }));
const auth = {
  user: { uid: '1', email: 'a@lab.test', name: null },
  ready: true,
  error: '',
  signIn: vi.fn(),
  signOut: vi.fn(),
  getIdToken: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  adminState.admin = true;
  adminState.checking = false;
  mocks.url = 'https://lab.test';
  mocks.health.mockResolvedValue({ ok: true });
  mocks.listTools.mockResolvedValue([
    {
      name: 'search_papers',
      description: 'Search papers',
      input_schema: {
        required: ['query'],
        properties: { query: { type: 'string' }, limit: { type: 'integer' } },
      },
    },
    { name: 'new_tool', description: 'New tool', input_schema: {} },
  ]);
  mocks.callTool.mockResolvedValue({
    papers: [
      { title: 'A paper', url: 'https://example.test', year: 2020, cited_by_count: 4, retracted: true },
    ],
    count: 1,
  });
});
function show() {
  return render(
    <AuthContext.Provider value={auth}>
      <Page />
    </AuthContext.Provider>,
  );
}
it('PG-05 fills an example, runs and shows results and JSON', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: /search_papers/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Điền ví dụ' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chạy công cụ' }));
  expect(await screen.findByRole('link', { name: 'A paper' })).toHaveAttribute(
    'href',
    'https://example.test',
  );
  expect(mocks.callTool).toHaveBeenCalledWith('search_papers', {
    query: 'large language models for title and abstract screening',
    limit: 5,
  });
  fireEvent.click(screen.getByRole('radio', { name: 'JSON' }));
  expect(screen.getByText(/"count": 1/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Khác' }));
  expect(screen.getByRole('button', { name: /new_tool/ })).toBeInTheDocument();
});
it('PG-06 shows validation and rate limit errors', async () => {
  mocks.callTool.mockRejectedValue(new LabResearchError(429, 'rate_limited', 'HTTP 429', 30));
  show();
  fireEvent.click(await screen.findByRole('button', { name: /search_papers/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Chạy công cụ' }));
  expect(screen.getByText('Trường này là bắt buộc.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/query/), { target: { value: 'AI education' } });
  expect(screen.queryByText('Trường này là bắt buộc.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Điền ví dụ' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chạy công cụ' }));
  expect(await screen.findByText(/Quá nhiều yêu cầu/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('Chi tiết kỹ thuật')).toBeInTheDocument());
});
it('PG-07 blocks signed-out access before calling the MCP server', async () => {
  adminState.admin = false;
  render(
    <AuthContext.Provider value={{ ...auth, user: null }}>
      <Page />
    </AuthContext.Provider>,
  );
  expect(await screen.findByText('Playground chỉ dành cho admin')).toBeInTheDocument();
  expect(screen.getByText(/Đăng nhập bằng tài khoản lab có quyền admin/)).toBeInTheDocument();
  expect(mocks.health).not.toHaveBeenCalled();
  expect(mocks.listTools).not.toHaveBeenCalled();
});
it('PG-08 shows an unconfigured server', async () => {
  mocks.url = '';
  mocks.health.mockRejectedValue(new LabResearchError(0, 'not_configured', 'Not configured'));
  render(<Page />);
  expect(screen.getByText(/Máy chủ chưa được cấu hình/)).toBeInTheDocument();
  expect(await screen.findByText('Không kết nối được')).toBeInTheDocument();
});

it('shows an explicit empty state when the catalog has no tools', async () => {
  mocks.listTools.mockResolvedValueOnce([]);
  show();
  expect(await screen.findByText('Chưa có công cụ khả dụng')).toBeInTheDocument();
});

it('recovers from a catalog error through retry', async () => {
  mocks.listTools.mockRejectedValueOnce(new LabResearchError(503, 'upstream', 'Worker unavailable'));
  show();
  expect(await screen.findByText(/Worker unavailable/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại' }));
  expect(await screen.findByRole('button', { name: /search_papers/ })).toBeInTheDocument();
});

it('explains when the Lab Research Worker rejects an authenticated SSO session', async () => {
  mocks.listTools.mockRejectedValueOnce(new LabResearchError(401, 'unauthorized', 'HTTP 401'));
  show();
  expect(await screen.findByText(/Worker từ chối phiên SSO hiện tại/)).toBeInTheDocument();
});

it('blocks direct Playground access for non-admins before calling the MCP server', async () => {
  adminState.admin = false;
  show();
  expect(await screen.findByText('Playground chỉ dành cho admin')).toBeInTheDocument();
  expect(mocks.health).not.toHaveBeenCalled();
  expect(mocks.listTools).not.toHaveBeenCalled();
});

it('waits for the server admin check before loading MCP tools', async () => {
  adminState.checking = true;
  show();
  expect(screen.getByText('Đang xác minh quyền quản trị…')).toBeInTheDocument();
  expect(mocks.health).not.toHaveBeenCalled();
  expect(mocks.listTools).not.toHaveBeenCalled();
});
