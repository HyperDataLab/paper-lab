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
vi.mock('@/shared/labResearch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/labResearch')>()),
  get LAB_RESEARCH_URL() {
    return mocks.url;
  },
  createLabResearchClient: () => mocks,
}));
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
  fireEvent.click(await screen.findByRole('button', { name: 'search_papers' }));
  fireEvent.click(screen.getByRole('button', { name: 'Điền ví dụ' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));
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
  fireEvent.click(screen.getByRole('radio', { name: 'Khác' }));
  expect(screen.getByRole('button', { name: 'new_tool' })).toBeInTheDocument();
});
it('PG-06 shows validation and rate limit errors', async () => {
  mocks.callTool.mockRejectedValue(new LabResearchError(429, 'rate_limited', 'HTTP 429', 30));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'search_papers' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));
  expect(screen.getByText('Trường này là bắt buộc.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Điền ví dụ' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));
  expect(await screen.findByText(/Quá nhiều yêu cầu/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('Chi tiết kỹ thuật')).toBeInTheDocument());
});
it('PG-07 shows the signed-out hint and failed health state', async () => {
  mocks.health.mockRejectedValue(new Error('offline'));
  render(
    <AuthContext.Provider value={{ ...auth, user: null }}>
      <Page />
    </AuthContext.Provider>,
  );
  expect(screen.getByText('Đăng nhập tài khoản lab để chạy công cụ')).toBeInTheDocument();
  expect(await screen.findByText('Không kết nối được')).toBeInTheDocument();
  expect(mocks.listTools).not.toHaveBeenCalled();
});
it('PG-08 shows an unconfigured server', async () => {
  mocks.url = '';
  mocks.health.mockRejectedValue(new LabResearchError(0, 'not_configured', 'Not configured'));
  render(<Page />);
  expect(screen.getByText(/chưa cấu hình/)).toBeInTheDocument();
  expect(await screen.findByText('Không kết nối được')).toBeInTheDocument();
});
