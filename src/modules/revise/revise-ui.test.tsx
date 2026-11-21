import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { analyzeText } from '@/core/text';
import type { Issue } from '@/core/schemas';
import type { LlmClient } from '@/shared/llm/client';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import Evaluate from '../evaluate/Page';
import History from '../history/Page';
import Revise from './Page';
import { testRepositories } from '@/shared/storage/testRepositories';

it('AC-07 AC-08 AC-12 selects issues, gates consent, displays diff and requires override before applying', async () => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  const repo = testRepositories();
  const issue: Issue = {
    id: 'issue-1',
    type: 'WEAK_MODIFIER',
    category: 'word',
    findingKind: 'review_candidate',
    status: 'confirmed_by_model',
    severity: 'minor',
    spans: [{ start: 8, end: 12, role: 'word' }],
    sentenceIds: ['s1'],
    metric: { name: 'modifier', value: 1, unit: null },
    why: 'Cần xem lại',
    suggestedFix: 'Bỏ từ',
    sourcePrinciple: 'Ch. 16',
    confidence: 0.8,
  };
  const source = await repo.analyses.create({
    text: await analyzeText('Results very improved 5%.'),
    title: 'Gốc',
    issues: [issue],
    versions: { detectors: 'test' },
  });
  const completeJson = vi.fn(async (options: Parameters<LlmClient['completeJson']>[0]) => ({
    data: options.schema.parse({
      revisedText: 'Results improved 7%.',
      changes: [{ issueIds: ['issue-1'], before: 'very', after: '', rationale: 'Bỏ từ thừa' }],
      needsEvidence: [{ issueId: 'issue-1', note: 'Cần số liệu' }],
    }),
    meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
  })) as LlmClient['completeJson'];
  const mount = (url: string) =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <StorageProvider repositories={repo}>
          <LlmProvider innerClient={{ completeJson }}>
            <Routes>
              <Route path="/evaluate" element={<Evaluate />} />
              <Route path="/revise" element={<Revise />} />
              <Route path="/history" element={<History />} />
            </Routes>
          </LlmProvider>
        </StorageProvider>
      </MemoryRouter>,
    );
  const view = mount(`/evaluate?id=${source.id}`);
  expect(await screen.findByRole('checkbox', { name: 'Chọn để chỉnh sửa' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa các gợi ý đã chọn' }));
  expect(await screen.findByText(/Từ bổ nghĩa cần xem xét: “very”/)).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Tạo bản sửa (AI)' }));
  expect(completeJson).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }));
  expect(await screen.findByText(/^Bỏ từ thừa · /)).toBeInTheDocument();
  expect(screen.getByTitle('numbers_preserved')).toHaveTextContent('Giữ nguyên số liệu');
  for (const [id, label] of [
    ['citations_preserved', 'Giữ nguyên trích dẫn'],
    ['negation_preserved', 'Giữ nguyên phủ định'],
    ['hedging_preserved', 'Giữ mức độ dè dặt'],
    ['preserve_terms', 'Giữ thuật ngữ'],
    ['length_change', 'Thay đổi độ dài'],
  ] as const)
    expect(screen.getByTitle(id)).toHaveTextContent(label);
  expect(document.querySelector('mark[aria-label]')).toBeInTheDocument();
  expect(screen.getByText(/Cần số liệu/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Áp dụng bản sửa' }));
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByText('Giữ nguyên số liệu')).toHaveAttribute('title', 'numbers_preserved');
  expect((await repo.analyses.list()).items).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận áp dụng' }));
  expect(await screen.findByRole('link', { name: 'Bản sửa của Gốc' })).toBeInTheDocument();
  const analyses = await repo.analyses.list();
  const child = analyses.items.find((item) => item.id !== source.id);
  expect((await repo.analyses.get(child?.id ?? ''))?.parentAnalysisId).toBe(source.id);
  expect(await repo.analyses.get(source.id)).toEqual(source);
  view.unmount();
  mount('/history');
  await waitFor(() => expect(screen.getByRole('link', { name: /Bản sửa ·/ })).toBeInTheDocument());
});

it.each(['issue', 'add term', 'remove term', 'leave'])(
  'R3 invalidates an in-flight revision on %s',
  async (action) => {
    vi.stubGlobal('crypto', webcrypto);
    localStorage.clear();
    const repo = testRepositories();
    const issue: Issue = {
      id: 'i',
      type: 'WEAK_MODIFIER',
      category: 'word',
      findingKind: 'review_candidate',
      status: 'confirmed_by_model',
      severity: 'minor',
      spans: [{ start: 0, end: 4, role: 'word' }],
      sentenceIds: ['s1'],
      metric: { name: 'x', value: 1, unit: null },
      why: 'why',
      suggestedFix: null,
      sourcePrinciple: 'Ch. 16',
      confidence: 1,
    };
    const source = await repo.analyses.create({ text: await analyzeText('Very clear.'), issues: [issue] });
    let resolveOutput: ((value: unknown) => void) | undefined;
    const completeJson = vi.fn(
      (options: Parameters<LlmClient['completeJson']>[0]) =>
        new Promise((resolve) => {
          resolveOutput = () =>
            resolve({
              data: options.schema.parse({ revisedText: 'Clear.', changes: [], needsEvidence: [] }),
              meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
            });
        }),
    ) as LlmClient['completeJson'];
    const view = render(
      <MemoryRouter initialEntries={[`/revise?analysis=${source.id}&issues=i`]}>
        <StorageProvider repositories={repo}>
          <LlmProvider innerClient={{ completeJson }}>
            <Routes>
              <Route path="/revise" element={<Revise />} />
              <Route path="/evaluate" element={<p>Evaluate</p>} />
            </Routes>
          </LlmProvider>
        </StorageProvider>
      </MemoryRouter>,
    );
    const start = await screen.findByRole('button', { name: 'Tạo bản sửa (AI)' });
    if (action === 'remove term') {
      fireEvent.change(screen.getByLabelText('Thuật ngữ cần giữ nguyên'), { target: { value: 'clear' } });
      fireEvent.click(screen.getByRole('button', { name: 'Thêm thuật ngữ' }));
    }
    fireEvent.click(start);
    fireEvent.click(await screen.findByRole('button', { name: 'Đồng ý và tiếp tục' }));
    await waitFor(() => expect(completeJson).toHaveBeenCalledTimes(1));
    if (action === 'issue') fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn' }));
    if (action === 'add term') {
      fireEvent.change(screen.getByLabelText('Thuật ngữ cần giữ nguyên'), { target: { value: 'clear' } });
      fireEvent.click(screen.getByRole('button', { name: 'Thêm thuật ngữ' }));
    }
    if (action === 'remove term') fireEvent.click(screen.getByRole('button', { name: 'Bỏ clear' }));
    if (action === 'leave') view.unmount();
    await act(async () => {
      resolveOutput?.(undefined);
    });
    expect(await repo.revisions.listBySource(source.id)).toEqual([]);
    if (action !== 'leave')
      expect(screen.queryByRole('button', { name: 'Áp dụng bản sửa' })).not.toBeInTheDocument();
  },
);
