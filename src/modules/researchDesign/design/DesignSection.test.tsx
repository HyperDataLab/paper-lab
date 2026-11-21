import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { snapshotFileSchema } from '@/core/researchDesign/bank/snapshot';
import { toBankDoc } from '@/core/researchDesign/bank/readSnapshot';
import { snapshot } from '@/core/researchDesign/bank/testSupport';
import { emptyResearchDesign } from '@/core/schemas/researchDesign';
import DesignSection from '../sections/DesignSection';
vi.mock('../evidence/SectionSuggest', () => ({ SectionSuggest: () => null }));

const state = vi.hoisted(() => ({ current: null as unknown, save: vi.fn() }));
vi.mock('../ResearchDesignProvider', () => ({ useResearchDesign: () => state.current }));
const bank = toBankDoc(snapshotFileSchema.parse(snapshot), 'new', 'test', '2026-01-01T00:00:00Z');
function setup(record = emptyResearchDesign('project'), hasBank = true) {
  state.current = {
    loading: false,
    error: null,
    design: record,
    bank: hasBank ? bank : null,
    save: state.save,
  };
  return render(
    <MemoryRouter>
      <DesignSection />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  state.save.mockReset();
  state.save.mockResolvedValue(undefined);
});
it('RD-01 chooses a design from the snapshot', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Chọn research design' }));
  fireEvent.click(
    within(screen.getByText('Test experiment').parentElement as HTMLElement).getByRole('button', {
      name: 'Chọn',
    }),
  );
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  const record = state.save.mock.calls[0]?.[0](emptyResearchDesign('project'));
  expect(record.draft.design).toMatchObject({
    name: 'Test experiment',
    assignment: 'random',
    bank: { release: 'new' },
  });
});
it('RD-04 adds an offered threat without adopting the bank mitigation', async () => {
  const record = emptyResearchDesign('project');
  record.draft.design = {
    name: 'Test experiment',
    assignment: 'random',
    bank: { id: 'rd.test-experiment', release: 'new' },
  };
  setup(record);
  fireEvent.click(screen.getByRole('button', { name: 'Thêm vào danh sách' }));
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  expect(state.save.mock.calls[0]?.[0](record).draft.threats[0]).toMatchObject({
    mitigation: '',
    bank: { id: 'vt.test-confound', release: 'new' },
  });
});
it('RD-05 permits a self-described design without a snapshot', async () => {
  setup(emptyResearchDesign('project'), false);
  fireEvent.click(screen.getByRole('button', { name: 'Chọn research design' }));
  expect(screen.getByRole('link', { name: 'Writing Bank' })).toHaveAttribute('href', '/?design=bank');
  fireEvent.change(screen.getByLabelText('Tên research design'), { target: { value: 'Synthetic study' } });
  fireEvent.click(screen.getByRole('button', { name: 'Chọn research design tự mô tả' }));
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
});
it('RD-09 re-pins resolvable references and retains missing references', async () => {
  const record = emptyResearchDesign('project');
  record.draft.design = {
    name: 'Test experiment',
    assignment: 'random',
    bank: { id: 'rd.test-experiment', release: 'old' },
  };
  record.draft.threats = [
    { id: 't-1', name: 'Missing', mitigation: '', bank: { id: 'vt.missing', release: 'old' } },
  ];
  setup(record);
  fireEvent.click(screen.getByRole('button', { name: 'Ghim lại theo bản chụp hiện tại' }));
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  const saved = state.save.mock.calls[0]?.[0](record);
  expect(saved.draft.design.bank.release).toBe('new');
  expect(saved.draft.threats[0].bank.release).toBe('old');
});

it('RD-02 DS-03 requires an assignment for a choice of design', () => {
  const record = emptyResearchDesign('project');
  record.draft.design = {
    name: 'Test benchmark',
    assignment: null,
    bank: { id: 'rd.test-benchmark', release: 'new' },
  };
  setup(record);
  expect(screen.getByText(/ch\u01b0a c\u00f3 c\u00e1ch ph\u00e2n nh\u00f3m/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Kh\u00f4ng ng\u1eabu nhi\u00ean' }));
  expect(state.save.mock.calls[0]?.[0](record).draft.design.assignment).toBe('non_random');
});
it('RD-03 DS-01 links an unsupported hypothesis to questions', () => {
  const record = emptyResearchDesign('project');
  record.draft.design = {
    name: 'Test experiment',
    assignment: 'random',
    bank: { id: 'rd.test-experiment', release: 'new' },
  };
  record.draft.hypotheses.push({
    id: 'h-1',
    statement: 'Synthetic',
    kind: 'directional',
    question: null,
    claim: 'ct.descriptive',
    independent: [],
    dependent: [],
  });
  setup(record);
  expect(screen.getByRole('link', { name: 'h-1' })).toHaveAttribute('href', '/?design=questions');
  expect(screen.getByText(/kh\u00f4ng h\u1ed7 tr\u1ee3 loại claim n\u00e0y/)).toBeInTheDocument();
});
it('RD-06 DS-05 reports a missing design reference', () => {
  const record = emptyResearchDesign('project');
  record.draft.design = { name: 'Old', assignment: 'random', bank: { id: 'rd.missing', release: 'old' } };
  setup(record);
  expect(
    screen.getByText(/kh\u00f4ng c\u00f2n trong b\u1ea3n ch\u1ee5p hi\u1ec7n t\u1ea1i/),
  ).toBeInTheDocument();
});
