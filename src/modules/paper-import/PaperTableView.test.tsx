import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { PaperParagraph, PaperTable } from '@/core/schemas';
import { PaperTableView } from './PaperTableView';

const table = (confidence: PaperTable['confidence']): PaperTable => ({
  captionId: 'cap',
  columns: 2,
  confidence,
  rows: [
    {
      cells: [
        { text: 'Baseline', column: 0 },
        { text: '0.123 ± 0.004', column: 1 },
      ],
    },
    {
      cells: [
        { text: 'Shifted', column: 0 },
        { text: '0.111', column: null },
      ],
    },
  ],
});
const caption = { id: 'cap', text: 'Table 1: Synthetic.' } as PaperParagraph;

it('M1 renders a table with its caption link', () => {
  render(<PaperTableView table={table('high')} caption={caption} />);
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '0.123 ± 0.004' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Table 1: Synthetic.' })).toHaveAttribute(
    'href',
    '#paper-paragraph-cap',
  );
  expect(screen.queryByText('Cần xem lại')).toBeNull();
});

it('M1 shows the review badge and keeps an unaligned cell visible', () => {
  render(<PaperTableView table={table('low')} />);
  expect(screen.getByText('Cần xem lại')).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '0.111' })).toBeInTheDocument();
});
