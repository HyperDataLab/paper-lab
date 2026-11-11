import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { JobProgress } from './JobProgress';

it('R15 progress chip shows running then done', () => {
  const open = vi.fn();
  const { rerender } = render(<JobProgress running={[]} count={2} onOpen={open} />);
  rerender(<JobProgress running={['Key facts']} count={2} onOpen={open} />);
  expect(screen.getByRole('status')).toHaveTextContent('Đang chạy: Key facts 1/1');
  rerender(<JobProgress running={[]} count={4} onOpen={open} />);
  fireEvent.click(screen.getByRole('button', { name: 'Xong · +2 issues' }));
  expect(open).toHaveBeenCalledOnce();
});
