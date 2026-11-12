import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { buildArgumentGraph } from '@/core/argument';
import type { Argument, Paper } from '@/core/schemas';
import { chooseSelectOption } from '@/test/selectOption';
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
  claimType: 'causal',
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
  claimType: 'comparative',
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

function showWholePaper() {
  const passage = (excerpt: string, start: number) => ({
    ...span(excerpt),
    start,
    end: start + excerpt.length,
  });
  const accuracy = passage('Accuracy reached 91% in Table 3', 100);
  const backing = passage('cites prior work [7]', 200);
  const items: Argument[] = [
    {
      ...first,
      id: 'arg-1',
      claim: passage('the method is always best', 0),
      data: [accuracy, passage('See Figure 2', 300)],
      backing: [backing],
      rebuttals: [passage('An introduction', 400)],
    },
    {
      ...second,
      id: 'arg-2',
      claim: passage('uses the ABC method', 500),
      data: [accuracy],
      statedWarrant: backing,
      rebuttals: [passage('in Table 3', 120)],
    },
  ];
  render(
    <ArgumentDiagram
      paper={paper}
      items={items}
      graph={buildArgumentGraph(items)}
      states={new Map()}
      view="aif"
      onLocation={vi.fn()}
      onDecide={vi.fn()}
    />,
  );
  chooseSelectOption('Lập luận', 'Toàn bài');
}

it('R5 whole-paper RA labels count the incoming premises for each argument', () => {
  showWholePaper();
  expect(within(screen.getByTestId('node-ra-arg-1')).getByText('3 tiền đề → 1 kết luận')).toBeInTheDocument();
  expect(within(screen.getByTestId('node-ra-arg-2')).getByText('2 tiền đề → 1 kết luận')).toBeInTheDocument();
});

it('R5 names the whole-paper AIF diagram for assistive technology', () => {
  showWholePaper();
  expect(screen.getByRole('group', { name: 'Lược đồ AIF của toàn bài (2 lập luận)' })).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Lược đồ AIF của lập luận 1' })).not.toBeInTheDocument();
});

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
  fireEvent.click(within(screen.getByTestId('node-data-0')).getByRole('button', { name: 'Results · Tr. 4' }));
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
  // An argument counts as accepted until the reader rejects it.
  expect(screen.queryByRole('button', { name: 'Xác nhận' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bác bỏ' }));
  expect(onDecide).toHaveBeenCalledWith('a1', 'dismiss');
  fireEvent.click(screen.getByRole('button', { name: 'Lập luận sau' }));
  expect(screen.getByRole('group', { name: 'Lược đồ AIF của lập luận 2' })).toBeInTheDocument();
  // A claim with no premise has no inference node to draw.
  expect(screen.queryByTestId('node-ra')).toBeNull();
  expect(screen.getByRole('button', { name: 'Lập luận sau' })).toBeDisabled();
});

it('R5 moves a card with arrow keys and restores its layout', () => {
  show('toulmin');
  const card = screen.getByTestId('node-claim');
  const handle = screen.getByRole('group', { name: 'Claim: di chuyển bằng phím mũi tên' });
  const original = Number(card.getAttribute('x'));
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(Number(card.getAttribute('x'))).toBe(original + 10);
  fireEvent.click(screen.getByRole('button', { name: 'Bố cục lại' }));
  expect(Number(card.getAttribute('x'))).toBe(original);
});
