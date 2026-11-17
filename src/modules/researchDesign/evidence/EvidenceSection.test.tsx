import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { emptyResearchDesign, type ResearchDesign } from '@/core/schemas/researchDesign';
import { readSnapshot, toBankDoc } from '@/core/researchDesign/bank/readSnapshot';
import { snapshot } from '@/core/researchDesign/bank/testSupport';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import EvidenceSection from '../sections/EvidenceSection';
import { facts, harness, model, paper, projectId } from './testSupport';

vi.mock('../ResearchDesignProvider', async () => ({
  useResearchDesign: (await import('./testSupport')).useTestDesign,
}));

const missingFacts = {
  ...facts,
  facts: facts.facts.map((fact, index) =>
    index === 1 ? { ...fact, sentenceKeys: ['missing#1'], tableCell: null } : fact,
  ),
};
const live = (value = facts) => ({ facts: value, model });

function bankDoc(noOffer = false) {
  const parsed = readSnapshot({
    ...snapshot,
    collections: {
      ...snapshot.collections,
      metrics: [{ ...snapshot.collections.metrics[0]!, aliases: noOffer ? [] : ['Accuracy'] }],
    },
  });
  if (!parsed.ok) throw Error('Invalid bank');
  return toBankDoc(parsed.file, '2026.01.1', 'local', '2026-01-01T00:00:00.000Z');
}

function stored(paperId: string, extra: Partial<ResearchDesign['facts'][string]>) {
  return {
    schemaVersion: 1 as const,
    paperId,
    source: {
      paperlabId: facts.paperId,
      etag: facts.modelEtag,
      fetchedBy: 'local',
      fetchedAt: facts.generatedAt,
    },
    facts,
    decisions: {},
    matches: {},
    ...extra,
  };
}

function setup(
  options: {
    missing?: boolean;
    second?: boolean;
    decided?: boolean;
    bank?: boolean;
    noOffer?: boolean;
    matched?: boolean;
    counts?: boolean;
    withFacts?: boolean;
    conflicts?: number;
  } = {},
) {
  const papers = [paper(1), ...(options.second ? [paper(2)] : [])];
  const value = options.counts
    ? { ...facts, facts: [...facts.facts, { ...facts.facts[0]!, id: 'fact-4' }] }
    : facts;
  const entries = Object.fromEntries(
    options.withFacts === false
      ? []
      : papers.map((entry, index) => [entry.id, live(options.missing && index === 0 ? missingFacts : value)]),
  );
  const design = emptyResearchDesign(projectId);
  for (const entry of papers)
    if (options.decided || options.matched)
      design.facts[entry.id] = stored(entry.id, {
        facts: value,
        decisions: options.decided
          ? {
              'fact-1': { decision: 'use', reason: null, by: 'local', at: '2026-01-01T00:00:00.000Z' },
              ...(options.counts
                ? { 'fact-4': { decision: 'use', reason: null, by: 'local', at: '2026-01-01T00:00:00.000Z' } }
                : {}),
            }
          : {},
        matches: options.matched
          ? {
              'fact-1': {
                bank: { id: 'met.test-score', release: '2025.01.1' },
                by: 'local',
                at: '2026-01-01T00:00:00.000Z',
              },
            }
          : {},
      });
  const context = harness({
    papers,
    live: entries,
    design,
    bank: options.bank ? bankDoc(options.noOffer) : null,
    conflicts: options.conflicts,
  });
  render(
    <MemoryRouter>
      <LlmProvider innerClient={{ completeJson: vi.fn() }}>
        <ToastProvider>
          <context.Harness>
            <EvidenceSection />
          </context.Harness>
        </ToastProvider>
      </LlmProvider>
    </MemoryRouter>,
  );
  return context;
}
async function openFact(value: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${value}`) }));
}

it('FR-303 shows ordered kinds, empty cells and facts', async () => {
  setup();
  await screen.findByText('Paper 1');
  expect(screen.getAllByRole('columnheader').map((e) => e.textContent)).toEqual([
    'Bài báo',
    'TaskPaperLab chưa cung cấp',
    'Dataset',
    'Baseline',
    'Phương pháp',
    'Metric',
    'Thiết kếPaperLab chưa cung cấp',
    'MẫuPaperLab chưa cung cấp',
    'Kết quả',
  ]);
  expect(screen.getAllByText('Không có').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Chưa duyệt').length).toBeGreaterThan(0);
});

it('shows the no-facts line with a link to measure the paper', async () => {
  setup({ withFacts: false });
  expect(await screen.findByText(/^Chưa có dữ kiện ·/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Chạy Đo lường cho bài này' })).toHaveAttribute(
    'href',
    '/papers/local-1?view=measure',
  );
});

it('lists included papers only', async () => {
  const context = harness({
    papers: [paper(1), paper(2, { decision: 'excluded' })],
    live: {},
  });
  render(
    <MemoryRouter>
      <LlmProvider innerClient={{ completeJson: vi.fn() }}>
        <context.Harness>
          <EvidenceSection />
        </context.Harness>
      </LlmProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByText('Paper 1')).toBeInTheDocument();
  expect(screen.queryByText('Paper 2')).toBeNull();
});

it('FR-303 a decision follows its fact when a newer run renumbers the facts', async () => {
  const design = emptyResearchDesign(projectId);
  design.facts['project-paper-1'] = stored('project-paper-1', {
    decisions: {
      'fact-2': {
        decision: 'exclude',
        reason: 'Invented reason',
        by: 'local',
        at: '2026-01-01T00:00:00.000Z',
      },
    },
  });
  const inserted = { ...facts.facts[1]!, id: 'fact-2', value: 'Newer baseline' };
  const renumbered = {
    ...facts,
    facts: [facts.facts[0]!, inserted, { ...facts.facts[1]!, id: 'fact-4' }, facts.facts[2]!],
  };
  const context = harness({ papers: [paper(1)], live: { 'project-paper-1': live(renumbered) }, design });
  render(
    <MemoryRouter>
      <LlmProvider innerClient={{ completeJson: vi.fn() }}>
        <context.Harness>
          <EvidenceSection />
        </context.Harness>
      </LlmProvider>
    </MemoryRouter>,
  );
  const fresh = await screen.findByRole('button', { name: /^Newer baseline/ });
  expect(within(fresh).queryByText('Loại')).toBeNull();
  const moved = screen.getByRole('button', { name: /^Baseline/ });
  expect(within(moved).getByText('Loại')).toBeInTheDocument();
});

it('FR-302 shows a found sentence as a quote with a link to the paper and reports a missing sentence', async () => {
  setup({ missing: true });
  await openFact('Accuracy');
  const sentence = model.sentences[0]!;
  expect((await screen.findByText(sentence.text)).closest('blockquote')).not.toBeNull();
  expect(screen.getByRole('link', { name: 'Paper 1 · Tr. 2' })).toHaveAttribute('href', '/papers/local-1');
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  await openFact('Baseline');
  expect(await screen.findByText('Không tìm thấy vị trí trong bài')).toBeInTheDocument();
  expect(screen.queryByText(/missing#1/)).not.toBeInTheDocument();
});

it('FR-302 disables Dùng when no anchor is found', async () => {
  setup({ missing: true });
  await openFact('Baseline');
  await screen.findByText('Không tìm thấy vị trí trong bài');
  expect(screen.getByRole('button', { name: 'Dùng' })).toBeDisabled();
});

it('shows the table cell coordinates and headers when its block exists', async () => {
  setup();
  await openFact('Baseline');
  expect(await screen.findByText('Bảng, hàng 1, cột 1')).toBeInTheDocument();
  expect(screen.getByText('Baseline Accuracy (%)')).toBeInTheDocument();
});

it('FR-303 requires an exclusion reason and preserves the facts as they came', async () => {
  const context = setup();
  await openFact('Accuracy');
  fireEvent.click(screen.getByRole('button', { name: 'Loại' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận loại' }));
  expect(await screen.findByText('Cần ghi lý do khi loại.')).toBeInTheDocument();
  expect(context.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Lý do loại'), { target: { value: 'Not relevant' } });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận loại' }));
  await waitFor(() => expect(context.saved).toHaveLength(1));
  const doc = context.saved[0]!.facts['project-paper-1']!;
  expect(doc.facts).toEqual(facts);
  expect(doc.decisions['fact-1']).toEqual({
    decision: 'exclude',
    reason: 'Not relevant',
    by: 'local',
    at: expect.any(String),
  });
  const at = doc.decisions['fact-1']!.at;
  expect(new Date(at).toISOString()).toBe(at);
  await waitFor(() => expect(screen.queryByLabelText('Lý do loại')).not.toBeInTheDocument());
});

it('Bỏ quyết định removes the stored decision', async () => {
  const context = setup({ decided: true });
  await openFact('Accuracy');
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ quyết định' }));
  await waitFor(() => expect(context.saved).toHaveLength(1));
  expect(context.saved[0]!.facts['project-paper-1']).toMatchObject({ decisions: {} });
});

it('bulk Dùng refuses all writes when a selected fact has no anchor', async () => {
  const context = setup({ missing: true });
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn Accuracy' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Baseline' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dùng' }));
  expect(
    await screen.findByText('Có dữ kiện không tìm thấy neo trong paper model đang giữ nên chưa thể dùng.'),
  ).toBeInTheDocument();
  expect(context.save).not.toHaveBeenCalled();
});

it('bulk Dùng writes anchored facts in two papers in one save', async () => {
  const context = setup({ second: true });
  const rows = await screen.findAllByRole('row');
  fireEvent.click(within(rows[1]!).getByRole('checkbox', { name: 'Chọn Accuracy' }));
  fireEvent.click(within(rows[2]!).getByRole('checkbox', { name: 'Chọn Accuracy' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dùng' }));
  await waitFor(() => expect(context.saved).toHaveLength(1));
  for (const id of ['project-paper-1', 'project-paper-2'])
    expect(context.saved[0]!.facts[id]!.decisions['fact-1']).toMatchObject({ decision: 'use' });
  expect(await screen.findAllByText('Dùng', { selector: 'span' })).toHaveLength(2);
});

it('FR-303 bulk Dùng across two papers writes nothing when a later paper has an unanchored fact', async () => {
  const context = setup({ missing: true, second: true });
  const rows = await screen.findAllByRole('row');
  fireEvent.click(within(rows[2]!).getByRole('checkbox', { name: 'Chọn Accuracy' }));
  fireEvent.click(within(rows[1]!).getByRole('checkbox', { name: 'Chọn Baseline' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dùng' }));
  expect(
    await screen.findByText('Có dữ kiện không tìm thấy neo trong paper model đang giữ nên chưa thể dùng.'),
  ).toBeInTheDocument();
  expect(context.save).not.toHaveBeenCalled();
});

it('re-applies the change once after a version conflict', async () => {
  const context = setup({ conflicts: 1 });
  await openFact('Accuracy');
  fireEvent.click(screen.getByRole('button', { name: 'Dùng' }));
  await waitFor(() => expect(context.saved).toHaveLength(1));
  expect(context.save).toHaveBeenCalledTimes(2);
});

it('shows a conflict after a second version conflict', async () => {
  const context = setup({ conflicts: 2 });
  await openFact('Accuracy');
  fireEvent.click(screen.getByRole('button', { name: 'Dùng' }));
  expect(await screen.findByText('Dữ kiện vừa được thay đổi ở nơi khác; hãy thử lại.')).toBeInTheDocument();
  expect(context.save).toHaveBeenCalledTimes(2);
  expect(context.saved).toHaveLength(0);
});

it('FR-304 offers a match, confirms it with attribution and preserves facts, then removes it', async () => {
  const context = setup({ bank: true });
  await openFact('Accuracy');
  expect(await screen.findByText(/Khớp theo tên: Test score/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await screen.findByRole('button', { name: 'Bỏ khớp' });
  const doc = context.saved[0]!.facts['project-paper-1']!;
  expect(doc.facts).toEqual(facts);
  expect(doc.matches['fact-1']).toEqual({
    bank: { id: 'met.test-score', release: '2026.01.1' },
    by: 'local',
    at: expect.any(String),
  });
  expect(new Date(doc.matches['fact-1']!.at).toISOString()).toBe(doc.matches['fact-1']!.at);
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ khớp' }));
  await waitFor(() => expect(context.saved).toHaveLength(2));
  expect(context.saved[1]!.facts['project-paper-1']).toMatchObject({ matches: {} });
});

it('FR-304 shows the quiet line when no entry matches', async () => {
  setup({ bank: true, noOffer: true });
  await openFact('Accuracy');
  expect(await screen.findByText('Không có mục trùng tên trong Writing Bank')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Xác nhận' })).not.toBeInTheDocument();
});

it('FR-304 flags a match from another release', async () => {
  setup({ bank: true, matched: true });
  await openFact('Accuracy');
  expect(await screen.findByText('Khác bản phát hành')).toBeInTheDocument();
  expect(screen.getByText('met.test-score')).toBeInTheDocument();
});

it('FR-304 hides Writing Bank without a snapshot', async () => {
  setup();
  await openFact('Accuracy');
  expect(screen.queryByText('Writing Bank')).not.toBeInTheDocument();
});

it('FR-305 counts papers once per value and only decisions to use', async () => {
  setup({ second: true, decided: true, counts: true });
  const card = (await screen.findByText('Dùng trong nhiều bài')).closest('section')!;
  expect(within(card).getByText('2 bài')).toBeInTheDocument();
  expect(within(card).getByText(/Accuracy/)).toBeInTheDocument();
  expect(within(card).queryByText('Baseline')).not.toBeInTheDocument();
  expect(within(card).getAllByRole('listitem')).toHaveLength(1);
});

it('FR-305 shows an empty line when no facts are used', async () => {
  setup();
  expect(await screen.findByText('Chưa có dữ kiện nào được đặt Dùng')).toBeInTheDocument();
});
