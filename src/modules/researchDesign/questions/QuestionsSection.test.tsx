import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { bankDocSchema, type BankDoc } from '@/core/researchDesign/bank/snapshot';
import { snapshot } from '@/core/researchDesign/bank/testSupport';
import { emptyResearchDesign } from '@/core/schemas/researchDesign';
import QuestionsSection from '../sections/QuestionsSection';

const state = vi.hoisted(() => ({
  update: vi.fn(),
  reload: vi.fn(),
  record: null as ReturnType<typeof emptyResearchDesign> | null,
  bank: null as BankDoc | null,
  loading: false,
  error: false,
}));
vi.mock('../ResearchDesignProvider', async () => {
  const { emptyResearchDesign } = await import('@/core/schemas/researchDesign');
  return {
    useResearchDesign: () => ({
      loading: state.loading,
      error: state.error ? new Error('offline') : null,
      design: state.record ?? emptyResearchDesign('project'),
      bank: state.bank,
      papers: { papers: [] },
      project: { papers: [] },
      update: state.update,
      reload: state.reload,
    }),
  };
});

afterEach(() => {
  Object.assign(state, { record: null, bank: null, loading: false, error: false });
  state.update.mockReset();
  state.reload.mockReset();
});

const show = () =>
  render(
    <MemoryRouter>
      <QuestionsSection />
    </MemoryRouter>,
  );
const question = () => ({ id: 'q-1', text: 'Synthetic question', gap: '', papers: [] });
const hypothesis = () => ({
  id: 'h-1',
  statement: 'Synthetic hypothesis',
  kind: 'directional' as const,
  question: null,
  claim: null,
  independent: [],
  dependent: [],
});

it('QH-02 renames a question without changing its id', async () => {
  const record = emptyResearchDesign('project');
  record.draft.questions.push(question());
  state.record = record;
  state.update.mockResolvedValue(undefined);
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
  fireEvent.change(screen.getByLabelText('Câu hỏi'), { target: { value: 'Renamed question' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(state.update).toHaveBeenCalledOnce(), { timeout: 5000 });
  const change = state.update.mock.calls[0]?.[0] as (value: typeof record) => typeof record;
  expect(change(record).draft.questions[0]).toMatchObject({ id: 'q-1', text: 'Renamed question' });
});

it('QH-03 adds a hypothesis linked to its question and QH-07 links to the bank', async () => {
  const record = emptyResearchDesign('project');
  record.draft.questions.push(question());
  state.record = record;
  state.update.mockResolvedValue(undefined);
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm giả thuyết' }));
  expect(screen.getByRole('link', { name: 'Writing Bank' })).toHaveAttribute('href', '/?design=bank');
  fireEvent.change(screen.getByLabelText('Phát biểu'), { target: { value: 'Synthetic hypothesis' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(state.update).toHaveBeenCalledOnce(), { timeout: 5000 });
  const change = state.update.mock.calls[0]?.[0] as (value: typeof record) => typeof record;
  expect(change(record).draft.hypotheses[0]).toMatchObject({
    id: 'h-1',
    question: 'q-1',
    statement: 'Synthetic hypothesis',
  });
});

it('QH-06 shows a design and claim mismatch', () => {
  const record = emptyResearchDesign('project');
  record.draft.design = {
    name: 'Test benchmark',
    assignment: null,
    bank: { id: 'rd.test-benchmark', release: 'sha256:0123456789abcdef' },
  };
  record.draft.hypotheses.push({ ...hypothesis(), claim: 'ct.causal' });
  state.record = record;
  state.bank = bankDocSchema.parse({
    schemaVersion: 1,
    release: 'sha256:0123456789abcdef',
    source: 'Synthetic',
    importedBy: 'test',
    importedAt: '2026-01-01T00:00:00Z',
    collections: snapshot.collections,
  });
  show();
  expect(screen.getByText(/h-1 là nhận định Causal.*không hỗ trợ/)).toBeInTheDocument();
});

it('QH-09 shows loading and empty states and QH-10 shows errors', () => {
  state.loading = true;
  const view = show();
  expect(screen.getByRole('status')).toBeInTheDocument();
  state.loading = false;
  view.rerender(
    <MemoryRouter>
      <QuestionsSection />
    </MemoryRouter>,
  );
  expect(screen.getByText('Chưa có câu hỏi nào.')).toBeInTheDocument();
  state.error = true;
  view.rerender(
    <MemoryRouter>
      <QuestionsSection />
    </MemoryRouter>,
  );
  expect(screen.getByText('Không tải được câu hỏi và giả thuyết.')).toBeInTheDocument();
});

it('QH-11 links the hypothesis chain to measurement', () => {
  const record = emptyResearchDesign('project');
  record.draft.hypotheses.push({ ...hypothesis(), dependent: ['v-1'] });
  record.draft.variables.push({
    id: 'v-1',
    name: 'Synthetic variable',
    role: 'dependent',
    construct: '',
    metric: 'm-1',
    levels: [],
  });
  record.draft.metrics.push({
    id: 'm-1',
    name: 'Synthetic metric',
    key: 'test/score',
    unit: '',
    goal: null,
    aggregation: null,
    protocol: '',
    bank: null,
    protocolBank: null,
  });
  state.record = record;
  show();
  expect(screen.getByRole('link', { name: 'v-1 Synthetic variable' })).toHaveAttribute(
    'href',
    '/?design=measurement',
  );
  expect(screen.getByRole('link', { name: 'm-1' })).toHaveAttribute('href', '/?design=measurement');
});

it('QH-12 names unused objects in delete confirmations and shows each chain warning once', () => {
  const record = emptyResearchDesign('project');
  record.draft.questions.push(question());
  record.draft.hypotheses.push(hypothesis());
  state.record = record;
  show();
  expect(screen.getAllByText('chưa có phân tích')).toHaveLength(1);
  expect(screen.getAllByText('chưa gắn biến phụ thuộc')).toHaveLength(1);
  for (const [index, id] of [
    [0, 'q-1'],
    [1, 'h-1'],
  ] as const) {
    fireEvent.click(screen.getAllByRole('button', { name: 'Xoá' })[index]!);
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(`Xoá ${id}?`)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Xoá' }).className).toMatch(/danger/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
  }
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
