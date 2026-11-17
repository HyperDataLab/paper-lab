import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { emptyResearchDesign, type ResearchDesign } from '@/core/schemas/researchDesign';
import { emptyTopicCheck } from '@/core/schemas/topicCheck';
import { researchDesignSections } from '../sections';
import TopicSection from '../sections/TopicSection';
const state = vi.hoisted(() => ({ record: null as ResearchDesign | null, update: vi.fn() }));
vi.mock('../ResearchDesignProvider', () => ({
  useResearchDesign: () => ({ loading: false, error: null, design: state.record, update: state.update }),
}));
beforeEach(() => {
  state.record = emptyResearchDesign('project');
  state.update.mockReset().mockResolvedValue(undefined);
});
it('shows the first topic section and its missing checklist', () => {
  render(<TopicSection />);
  expect(researchDesignSections[0].id).toBe('topic');
  expect(screen.getByText('Phát biểu đề tài (gợi ý): Còn thiếu')).toBeInTheDocument();
  expect(screen.getByText('PICO')).toBeInTheDocument();
});
it('switches track and offers optional PICO', () => {
  const view = render(<TopicSection />);
  fireEvent.click(screen.getByRole('radio', { name: 'Nghiên cứu thực nghiệm' }));
  const change = state.update.mock.calls[0]?.[0] as (d: ResearchDesign) => ResearchDesign;
  state.record = change(state.record!);
  view.rerender(<TopicSection />);
  expect(screen.queryByText('PICO')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm PICO (tuỳ chọn)' }));
  expect(screen.getByText('PICO')).toBeInTheDocument();
});
it('adds a neighbour', () => {
  render(<TopicSection />);
  fireEvent.click(screen.getByRole('button', { name: 'Thêm bài gần nhất' }));
  const change = state.update.mock.calls[0]?.[0] as (d: ResearchDesign) => ResearchDesign;
  expect(change(state.record!).topicCheck?.neighbours).toEqual([
    { ref: '', label: '', difference: '', source: 'researcher' },
  ]);
});
it('saves a human decision', () => {
  render(<TopicSection />);
  fireEvent.click(screen.getByRole('radio', { name: 'Điều chỉnh' }));
  const change = state.update.mock.calls[0]?.[0] as (d: ResearchDesign) => ResearchDesign;
  expect(change(state.record!).topicCheck?.decision).toMatchObject({
    verdict: 'adjust',
    decidedAt: expect.any(String),
  });
});
it('copies the statement to the selected question', () => {
  state.record!.topicCheck = { ...emptyTopicCheck(), statement: 'Synthetic gap' };
  state.record!.draft.questions.push({ id: 'q-1', text: 'Question?', gap: '', papers: [] });
  render(<TopicSection />);
  fireEvent.click(screen.getByRole('combobox', { name: 'Chọn câu hỏi' }));
  fireEvent.click(screen.getByRole('option', { name: 'Question?' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dùng làm khoảng trống cho câu hỏi' }));
  const change = state.update.mock.calls[0]?.[0] as (d: ResearchDesign) => ResearchDesign;
  expect(change(state.record!).draft.questions[0]?.gap).toBe('Synthetic gap');
});
