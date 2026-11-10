import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Argument, Paper } from '@/core/schemas';
import { ArgumentDiagram } from './ArgumentDiagram';

const paper = {
  id: '00000000-0000-4000-8000-000000000001',
  sections: [{ id: 's', heading: 'Results' }],
  paragraphs: [{ id: 'p1', sectionId: 's', pageStart: 4, text: '' }],
} as unknown as Paper;
const span = (excerpt: string) => ({
  paragraphId: 'p1',
  sectionId: 's',
  page: 4,
  start: 0,
  end: excerpt.length,
  excerpt,
});
const first: Argument = {
  id: 'a1',
  importance: 'main',
  claim: span('X improves Y.'),
  data: [span('Y rose 12%.')],
  statedWarrant: null,
  inferredWarrant: 'A rise in Y reflects X.',
  backing: [],
  qualifier: null,
  rebuttals: [span('unless Z')],
};
const second: Argument = {
  ...first,
  id: 'a2',
  importance: 'supporting',
  claim: span('X is cheap.'),
  data: [],
  inferredWarrant: null,
  rebuttals: [],
};
const show = (view: 'toulmin' | 'aif', onLocation = vi.fn(), onDecide = vi.fn()) =>
  render(
    <ArgumentDiagram
      paper={paper}
      items={[first, second]}
      states={new Map()}
      view={view}
      onLocation={onLocation}
      onDecide={onDecide}
    />,
  );

it('R4 Toulmin is drawn as a diagram: empty slots say so, and an inferred warrant is marked as not the author words', () => {
  const onLocation = vi.fn();
  show('toulmin', onLocation);
  const diagram = screen.getByRole('group', { name: 'Lược đồ Toulmin của lập luận 1' });
  expect(within(screen.getByTestId('node-claim')).getByText('X improves Y.')).toBeInTheDocument();
  expect(within(screen.getByTestId('node-warrant')).getByText('AI suy ra')).toBeInTheDocument();
  expect(within(screen.getByTestId('node-warrant')).getByText('Không phải lời tác giả')).toBeInTheDocument();
  for (const id of ['node-backing-0', 'node-qualifier'])
    expect(within(screen.getByTestId(id)).getByText('Chưa xác định')).toBeInTheDocument();
  expect(screen.getByText(/4\/6 thành phần đã xác định/)).toBeInTheDocument();
  // The rebuttal line is dashed and labelled, not only coloured.
  expect(within(diagram).getByText('Trừ khi')).toBeInTheDocument();
  expect(diagram.querySelector('path[data-tone="conflict"]')).toHaveAttribute('data-dashed', 'true');
  // A passage opens in the paper.
  fireEvent.click(within(screen.getByTestId('node-data-0')).getByRole('button', { name: 'Tr. 4 · Results' }));
  expect(onLocation).toHaveBeenCalledWith(first.data[0]);
});

it('R4 AIF is drawn with RA and CA nodes between statements, and the reader steps through arguments', () => {
  const onDecide = vi.fn();
  show('aif', vi.fn(), onDecide);
  expect(screen.getByRole('group', { name: 'Lược đồ AIF của lập luận 1' })).toBeInTheDocument();
  expect(within(screen.getByTestId('node-ra')).getByText('RA')).toBeInTheDocument();
  expect(within(screen.getByTestId('node-ra')).getByText('1 tiền đề → 1 kết luận')).toBeInTheDocument();
  expect(within(screen.getByTestId('node-ca-0')).getByText('CA')).toBeInTheDocument();
  // The inferred warrant is not a passage of the paper, so it is not a premise.
  expect(screen.queryByText('A rise in Y reflects X.')).toBeNull();
  expect(screen.getByText('1 / 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  expect(onDecide).toHaveBeenCalledWith('a1', 'confirm');
  fireEvent.click(screen.getByRole('button', { name: 'Lập luận sau' }));
  expect(screen.getByRole('group', { name: 'Lược đồ AIF của lập luận 2' })).toBeInTheDocument();
  // A claim with no premise has no inference node to draw.
  expect(screen.queryByTestId('node-ra')).toBeNull();
  expect(screen.getByRole('button', { name: 'Lập luận sau' })).toBeDisabled();
});
