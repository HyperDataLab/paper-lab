import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
it('redirects / to the evaluate page', async () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: 'Đánh giá' })).toBeInTheDocument();
});
it('shows a 404 for unknown paths', () => {
  render(
    <MemoryRouter initialEntries={['/unknown']}>
      <App />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument();
});
