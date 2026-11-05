import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { modules } from './modules';
beforeEach(() => localStorage.clear());
it('renders groups, entries, disabled upcoming items and the active page', () => {
  render(
    <MemoryRouter initialEntries={['/evaluate']}>
      <Sidebar />
    </MemoryRouter>,
  );
  for (const label of ['PHÂN TÍCH', 'DỮ LIỆU', 'SẮP CÓ']) expect(screen.getByText(label)).toBeInTheDocument();
  for (const item of modules) {
    if (item.status === 'soon') {
      const node = screen.getByLabelText(item.label, { selector: '[aria-disabled]' });
      expect(node).toHaveAttribute('aria-disabled', 'true');
      expect(node.tagName).not.toBe('A');
    } else expect(screen.getByRole('link', { name: new RegExp(item.label) })).toBeInTheDocument();
  }
});
it('marks the active link and persists collapse', () => {
  const view = render(
    <MemoryRouter initialEntries={['/evaluate']}>
      <Sidebar />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'Đánh giá' })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('button', { name: 'Thu gọn thanh bên' }));
  expect(localStorage.getItem('sidebar-collapsed')).toBe('true');
  view.unmount();
  render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
  expect(screen.getByRole('button', { name: 'Mở rộng thanh bên' })).toBeInTheDocument();
});
it('continues when storage throws', () => {
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Thu gọn thanh bên' }));
  expect(screen.getByRole('button', { name: 'Mở rộng thanh bên' })).toBeInTheDocument();
  get.mockRestore();
  set.mockRestore();
});
