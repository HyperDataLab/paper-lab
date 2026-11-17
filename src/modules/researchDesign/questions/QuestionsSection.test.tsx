import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { emptyResearchDesign } from '@/core/schemas/researchDesign';
import QuestionsSection from '../sections/QuestionsSection';

const state = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../ResearchDesignProvider', async () => {
  const { emptyResearchDesign } = await import('@/core/schemas/researchDesign');
  return {
    useResearchDesign: () => ({
      loading: false,
      error: null,
      design: emptyResearchDesign('project'),
      bank: null,
      papers: { papers: [] },
      save: state.save,
    }),
  };
});

it('saves a question and its gap through the provider', async () => {
  state.save.mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <QuestionsSection />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Th\u00eam c\u00e2u h\u1ecfi' }));
  fireEvent.change(screen.getByLabelText('C\u00e2u h\u1ecfi'), { target: { value: 'Synthetic question?' } });
  fireEvent.change(screen.getByLabelText('Kho\u1ea3ng tr\u1ed1ng'), { target: { value: 'Synthetic gap' } });
  fireEvent.click(screen.getByRole('button', { name: 'L\u01b0u' }));
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  const update = state.save.mock.calls[0]?.[0] as (
    value: ReturnType<typeof emptyResearchDesign>,
  ) => ReturnType<typeof emptyResearchDesign>;
  expect(update(emptyResearchDesign('project')).draft.questions[0]).toMatchObject({
    id: 'q-1',
    gap: 'Synthetic gap',
  });
});
