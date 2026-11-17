import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { YearBars } from './YearBars';
it('TC-22 exposes each year and count as a labelled bar and table', () => {
  render(<YearBars counts={{ '2025': 3, '2026': 0 }} />);
  expect(screen.getByRole('img', { name: '2025: 3 bài' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: '2026: 0 bài' })).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Số bài theo năm' })).toBeInTheDocument();
});
