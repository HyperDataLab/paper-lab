import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { emptyResearchDesign } from '@/core/schemas/researchDesign';
import QuestionsSection from '../sections/QuestionsSection';

const state = vi.hoisted(() => ({
  update: vi.fn(),
  reload: vi.fn(),
  record: null as ReturnType<typeof emptyResearchDesign> | null,
}));
vi.mock('../ResearchDesignProvider', async () => {
  const { emptyResearchDesign } = await import('@/core/schemas/researchDesign');
  return {
    useResearchDesign: () => ({
      loading: false,
      error: null,
      design: state.record ?? emptyResearchDesign('project'),
      bank: null,
      papers: { papers: [] },
      project: { papers: [] },
      update: state.update,
      reload: state.reload,
    }),
  };
});

it('QH-03 QH-05 refuses deleting a question with hypotheses', () => {
  const record = emptyResearchDesign('project');
  record.draft.questions.push({ id: 'q-1', text: 'Synthetic question?', gap: '', papers: [] });
  record.draft.hypotheses.push({
    id: 'h-1',
    statement: 'Synthetic hypothesis',
    kind: 'directional',
    question: 'q-1',
    claim: null,
    independent: [],
    dependent: [],
  });
  state.record = record;
  render(
    <MemoryRouter>
      <QuestionsSection />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Xoá' })[0]!);
  expect(screen.getByText(/còn 1 giả thuyết/)).toBeInTheDocument();
  expect(screen.getByRole('alertdialog')).not.toHaveTextContent('Xoá q-1?');
  state.record = null;
});

it('QH-04 QH-11 shows unattached hypotheses and the incomplete chain', () => {
  const record = emptyResearchDesign('project');
  record.draft.hypotheses.push({
    id: 'h-1',
    statement: 'Synthetic hypothesis',
    kind: 'directional',
    question: null,
    claim: null,
    independent: [],
    dependent: [],
  });
  state.record = record;
  render(
    <MemoryRouter>
      <QuestionsSection />
    </MemoryRouter>,
  );
  expect(screen.getByText('Chưa gắn câu hỏi')).toBeInTheDocument();
  expect(screen.getByText('chưa gắn biến phụ thuộc')).toBeInTheDocument();
  expect(screen.getByText('chưa có phân tích')).toBeInTheDocument();
  state.record = null;
});

it('QH-01 saves a question and its gap through the provider', async () => {
  state.update.mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <QuestionsSection />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Th\u00eam c\u00e2u h\u1ecfi' }));
  fireEvent.change(screen.getByLabelText('C\u00e2u h\u1ecfi'), { target: { value: 'Synthetic question?' } });
  fireEvent.change(screen.getByLabelText('Kho\u1ea3ng tr\u1ed1ng'), { target: { value: 'Synthetic gap' } });
  fireEvent.click(screen.getByRole('button', { name: 'L\u01b0u' }));
  await waitFor(() => expect(state.update).toHaveBeenCalledOnce());
  const update = state.update.mock.calls[0]?.[0] as (
    value: ReturnType<typeof emptyResearchDesign>,
  ) => ReturnType<typeof emptyResearchDesign>;
  expect(update(emptyResearchDesign('project')).draft.questions[0]).toMatchObject({
    id: 'q-1',
    gap: 'Synthetic gap',
  });
});
