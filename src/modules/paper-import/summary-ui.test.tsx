import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Paper, PaperInsightsRecord } from '@/core/schemas';
import { PaperSummary } from './PaperSummary';

const RUN = '00000000-0000-4000-8000-0000000000aa';
const paper = {
  id: '00000000-0000-4000-8000-000000000001',
  sections: [{ id: 's', heading: 'Results' }],
  paragraphs: [{ id: 'p1', sectionId: 's', pageStart: 4, text: 'X improves Y. Y rose 12%.' }],
} as unknown as Paper;
const span = (start: number, end: number, excerpt: string) => ({
  paragraphId: 'p1',
  sectionId: 's',
  page: 4,
  start,
  end,
  excerpt,
});
const insights = {
  decisions: [],
  rhetoricRuns: [],
  snapshotRuns: [],
  argumentRuns: [
    {
      id: RUN,
      arguments: [
        {
          id: 'a1',
          importance: 'main',
          claim: span(0, 13, 'X improves Y.'),
          data: [span(14, 25, 'Y rose 12%.')],
          statedWarrant: null,
          inferredWarrant: 'A rise in Y reflects X.',
          backing: [],
          qualifier: null,
          rebuttals: [],
        },
      ],
    },
  ],
} as unknown as PaperInsightsRecord;

it("R3 shows the author's main claim with what it rests on, and labels an inferred warrant as not the author's", () => {
  const onLocation = vi.fn();
  render(<PaperSummary paper={paper} insights={insights} onLocation={onLocation} onOpen={vi.fn()} />);
  const claims = screen.getByRole('region', { name: /Main claims/ });
  expect(within(claims).getByText('“X improves Y.”').tagName).toBe('STRONG');
  expect(within(claims).getByText('“Y rose 12%.”')).toBeInTheDocument();
  expect(within(claims).getByText('AI suy ra, không phải lời tác giả')).toBeInTheDocument();
  // Every quote opens its passage in the paper.
  fireEvent.click(within(claims).getAllByRole('button', { name: 'Results · Tr. 4' })[1] as HTMLElement);
  expect(onLocation).toHaveBeenCalledWith({ paragraphId: 'p1', start: 14, end: 25 });
});

it('R3 offers to open an analysis that has not run instead of showing an empty summary', () => {
  const onOpen = vi.fn();
  render(<PaperSummary paper={paper} insights={insights} onLocation={vi.fn()} onOpen={onOpen} />);
  const question = screen.getByRole('region', { name: /Research gap & contribution/ });
  expect(within(question).getByText('Chưa phân tích cách tác giả dẫn dắt.')).toBeInTheDocument();
  fireEvent.click(within(question).getByRole('button', { name: 'Mở để phân tích' }));
  expect(onOpen).toHaveBeenCalledWith('moves');
  const facts = screen.getByRole('region', { name: /Key facts/ });
  fireEvent.click(within(facts).getByRole('button', { name: 'Mở để phân tích' }));
  expect(onOpen).toHaveBeenCalledWith('snapshot');
  // With nothing run at all, the limits section is simply absent.
  expect(screen.queryByRole('region', { name: /Stated limitations/ })).toBeNull();
});
