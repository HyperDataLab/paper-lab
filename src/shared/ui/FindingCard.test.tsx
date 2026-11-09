import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ActionMenu, Stat } from './ActionBar';
import { FindingCard, ReviewActions } from './FindingCard';

it('shows a finding in a fixed order and opens its source', () => {
  const onOpen = vi.fn();
  render(
    <FindingCard labels={<span>Loại</span>} quote="Trích dẫn" source={{ label: 'Tr. 3', onOpen }}>
      <p>Nội dung</p>
    </FindingCard>,
  );
  expect(screen.getByText('Trích dẫn').tagName).toBe('BLOCKQUOTE');
  fireEvent.click(screen.getByRole('button', { name: 'Tr. 3' }));
  expect(onOpen).toHaveBeenCalled();
});

it('swaps the review choices for undo once decided', () => {
  const handlers = { onConfirm: vi.fn(), onDismiss: vi.fn(), onUndo: vi.fn() };
  const view = render(<ReviewActions decided={false} {...handlers} />);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua' }));
  expect(handlers.onConfirm).toHaveBeenCalled();
  expect(handlers.onDismiss).toHaveBeenCalled();
  view.rerender(<ReviewActions decided {...handlers} />);
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
  expect(handlers.onUndo).toHaveBeenCalled();
});

it('opens a menu, runs a choice and closes on Escape or an outside click', () => {
  const onSelect = vi.fn();
  render(<ActionMenu label="Xuất" items={[{ label: 'CSV', onSelect }]} />);
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Xuất' }));
  open();
  fireEvent.click(screen.getByRole('menuitem', { name: 'CSV' }));
  expect(onSelect).toHaveBeenCalled();
  expect(screen.queryByRole('menu')).toBeNull();
  open();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  open();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('makes a stat clickable only when it leads somewhere', () => {
  const onClick = vi.fn();
  const view = render(<Stat value={3} label="metric" onClick={onClick} />);
  fireEvent.click(screen.getByRole('button'));
  expect(onClick).toHaveBeenCalled();
  view.rerender(<Stat value={3} label="metric" />);
  expect(screen.queryByRole('button')).toBeNull();
});
