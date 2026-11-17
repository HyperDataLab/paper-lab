import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { emptyTopicCheck } from '@/core/schemas/topicCheck';
import { PaperRow } from './PaperRow';
it('TC-21 adds a paper, marks it read and shows retraction', () => {
  const check = emptyTopicCheck();
  const change = vi.fn((fn) => {
    Object.assign(check, fn(check));
  });
  const paper = {
    id: 'W1',
    doi: '10.1/test',
    title: 'Example',
    cited_by_count: 1,
    counts_by_year: {},
    url: 'https://example.test',
    retracted: true,
  };
  const view = render(
    <ul>
      <PaperRow paper={paper} check={check} change={change} review />
    </ul>,
  );
  expect(screen.getByText('Đã rút lại')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm vào bài gần nhất' }));
  expect(check.neighbours[0]).toMatchObject({ ref: paper.doi, source: 'tool' });
  view.rerender(
    <ul>
      <PaperRow paper={paper} check={check} change={change} review />
    </ul>,
  );
  expect(screen.getByRole('button', { name: 'Thêm vào bài gần nhất' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Đã đọc' }));
  expect(check.reviewedIds).toEqual(['W1']);
});
