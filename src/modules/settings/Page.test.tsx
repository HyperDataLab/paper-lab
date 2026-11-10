import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import Page from './Page';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
it('restores defaults, clears the key and disables key controls for relative URLs', () => {
  render(
    <LlmProvider>
      <Page />
    </LlmProvider>,
  );
  const url = screen.getByLabelText('Base URL');
  const key = screen.getByLabelText('API key');
  expect(screen.getByRole('button', { name: 'Hiện khoá' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Xoá khoá' })).toBeDisabled();
  fireEvent.change(url, { target: { value: 'https://router.example' } });
  expect(screen.getByRole('button', { name: 'Hiện khoá' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Xoá khoá' })).toBeEnabled();
  fireEvent.change(key, { target: { value: 'fake-key' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Khôi phục mặc định' }));
  expect(url).toHaveValue('/llm');
  expect(key).toHaveValue('');
  expect(localStorage.getItem('pl.llm.key')).toBeNull();
  expect(screen.getByRole('button', { name: 'Hiện khoá' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Xoá khoá' })).toBeDisabled();
});
it('PRD §9 Privacy asks for consent before a connection test and displays success', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true,"model":"demo"}' } }] })),
    );
  render(
    <LlmProvider>
      <Page />
    </LlmProvider>,
  );
  expect(screen.getByLabelText('API key')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }));
  expect(await screen.findByText(/Kết nối thành công: demo/)).toBeInTheDocument();
});
it('enables direct key entry and maps 401', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
  render(
    <LlmProvider>
      <Page />
    </LlmProvider>,
  );
  fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://router.example' } });
  expect(screen.getByLabelText('API key')).toBeEnabled();
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }));
  await waitFor(() => expect(screen.getByText('Khoá không hợp lệ')).toBeInTheDocument());
});
it('shows the network error message after retries fail', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network unavailable'));
  render(
    <LlmProvider>
      <Page />
    </LlmProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }));
  expect(
    await screen.findByText('Không kết nối được (kiểm tra CORS hoặc mạng)', {}, { timeout: 5000 }),
  ).toBeInTheDocument();
});
it('P1 saves the run ceiling once in Settings and rejects an out-of-range value', () => {
  render(
    <LlmProvider>
      <Page />
    </LlmProvider>,
  );
  fireEvent.change(screen.getByLabelText('Cách đặt trần'), { target: { value: 'fixed' } });
  fireEvent.change(screen.getByLabelText('Trần cố định (lượt gọi)'), { target: { value: '300' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu giới hạn chạy' }));
  expect(screen.getByText('Đã lưu giới hạn chạy.')).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('pl.run.defaults') ?? '{}')).toMatchObject({
    mode: 'fixed',
    fixed: 300,
  });
  fireEvent.change(screen.getByLabelText('Trần cố định (lượt gọi)'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu giới hạn chạy' }));
  expect(screen.getByText(/Giá trị chưa hợp lệ/)).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('pl.run.defaults') ?? '{}')).toMatchObject({ fixed: 300 });
});
