import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  expect(screen.getByText('Phát biểu đề tài (gợi ý)')).toBeInTheDocument();
  expect(screen.getByText('0/9 đã có')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Khung PICO' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Phơi nhiễm hoặc can thiệp' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Tóm tắt cho người không chuyên' })).toBeInTheDocument();
});
it('preserves saved assessment values and changes the interest rating with arrow keys', async () => {
  state.record!.topicCheck = {
    ...emptyTopicCheck(),
    convergence: { interest: 2, feasibility: 'A feasibility note', debateAlive: 'yes' },
    pico: {
      population: 'Older adults',
      exposure: 'A long intervention description that remains readable in its own field',
      comparison: 'Usual care',
      outcome: 'Patient reported outcome',
    },
    plainSummary: 'A saved plain-language summary.',
  };
  render(<TopicSection />);
  expect(screen.getByRole('radio', { name: '2' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('textbox', { name: 'Phơi nhiễm hoặc can thiệp' })).toHaveValue(
    'A long intervention description that remains readable in its own field',
  );
  fireEvent.keyDown(screen.getByRole('radio', { name: '2' }), { key: 'ArrowRight' });
  await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1));
  const change = state.update.mock.calls.at(-1)?.[0] as (design: ResearchDesign) => ResearchDesign;
  expect(change(state.record!).topicCheck?.convergence.interest).toBe(3);
});
it('updates a segmented choice before a remote save finishes', () => {
  state.update.mockImplementation(() => new Promise(() => {}));
  render(<TopicSection />);
  fireEvent.click(screen.getByRole('radio', { name: '4' }));
  expect(screen.getByRole('radio', { name: '4' })).toHaveAttribute('aria-checked', 'true');
});
it('saves long PICO and note drafts without changing their content', async () => {
  render(<TopicSection />);
  const picoText = 'Intervention with long Vietnamese detail: tác động theo dõi trong nhiều tháng';
  const feasibilityText = 'Feasibility note with multiple lines\nfor a realistic study schedule.';
  const summaryText = 'A long plain language summary that stays intact while its field expands.';

  const pico = screen.getByRole('textbox', { name: 'Phơi nhiễm hoặc can thiệp' });
  fireEvent.change(pico, { target: { value: picoText } });
  fireEvent.blur(pico);
  await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1));
  const savePico = state.update.mock.calls.at(-1)?.[0] as (design: ResearchDesign) => ResearchDesign;
  expect(savePico(state.record!).topicCheck?.pico.exposure).toBe(picoText);

  const feasibility = screen.getByRole('textbox', { name: 'Ghi chú tính khả thi' });
  fireEvent.change(feasibility, { target: { value: feasibilityText } });
  fireEvent.blur(feasibility);
  await waitFor(() => expect(state.update).toHaveBeenCalledTimes(2));
  const saveFeasibility = state.update.mock.calls.at(-1)?.[0] as (design: ResearchDesign) => ResearchDesign;
  expect(saveFeasibility(state.record!).topicCheck?.convergence.feasibility).toBe(feasibilityText);

  const summary = screen.getByRole('textbox', { name: 'Tóm tắt cho người không chuyên' });
  fireEvent.change(summary, { target: { value: summaryText } });
  fireEvent.blur(summary);
  await waitFor(() => expect(state.update).toHaveBeenCalledTimes(3));
  const saveSummary = state.update.mock.calls.at(-1)?.[0] as (design: ResearchDesign) => ResearchDesign;
  expect(saveSummary(state.record!).topicCheck?.plainSummary).toBe(summaryText);
});
it('switches track and offers optional PICO', async () => {
  const view = render(<TopicSection />);
  fireEvent.click(screen.getByRole('radio', { name: 'Nghiên cứu thực nghiệm' }));
  await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1));
  const change = state.update.mock.calls[0]?.[0] as (d: ResearchDesign) => ResearchDesign;
  state.record = change(state.record!);
  view.rerender(<TopicSection />);
  expect(screen.queryByRole('heading', { name: 'Khung PICO' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm PICO (tuỳ chọn)' }));
  expect(screen.getByRole('heading', { name: 'Khung PICO' })).toBeInTheDocument();
});
it('adds a neighbour', async () => {
  render(<TopicSection />);
  fireEvent.click(screen.getByRole('button', { name: '+ Thêm bài' }));
  await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1));
  const change = state.update.mock.calls[0]?.[0] as (d: ResearchDesign) => ResearchDesign;
  expect(change(state.record!).topicCheck?.neighbours).toEqual([
    { ref: '', label: '', difference: '', source: 'researcher' },
  ]);
});
it('saves a human decision', async () => {
  render(<TopicSection />);
  fireEvent.click(screen.getByRole('radio', { name: 'Điều chỉnh' }));
  await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1));
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
  fireEvent.click(screen.getByRole('combobox', { name: 'Câu hỏi nghiên cứu' }));
  fireEvent.click(screen.getByRole('option', { name: 'Question?' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dùng làm research gap' }));
  const change = state.update.mock.calls[0]?.[0] as (d: ResearchDesign) => ResearchDesign;
  expect(change(state.record!).draft.questions[0]?.gap).toBe('Synthetic gap');
});
