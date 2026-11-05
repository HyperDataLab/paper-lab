import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CommandPalette } from './CommandPalette';
it('opens with Ctrl+K, filters, navigates with Enter and closes with Escape', () => {
  render(
    <MemoryRouter>
      <CommandPalette />
      <Routes>
        <Route path="/history" element={<p>History page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  const input = screen.getByRole('textbox', { name: 'Tìm chức năng' });
  fireEvent.change(input, { target: { value: 'Lịch sử' } });
  expect(screen.queryByRole('button', { name: 'Đánh giá' })).not.toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByText('History page')).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
