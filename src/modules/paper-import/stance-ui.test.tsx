import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Paper } from '@/core/schemas';
import { buildStanceRun, planStance } from '@/core/stance';
import type { LlmClient } from '@/shared/llm/client';
import { getConfig } from '@/shared/llm/config';
import { acceptConsent } from '@/shared/llm/consent';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories, type Repositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { PaperStance } from './PaperStance';

const TEXT = 'We think this may help readers in practice.';
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: 'T',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  source: { kind: 'text', fileName: 'x', pageCount: 1, sha256: 's' },
  sections: [{ id: 'a', heading: 'Results', role: 'results', level: 1, pageStart: 1 }],
  paragraphs: [{ id: 'p1', sectionId: 'a', order: 0, text: TEXT, pageStart: 2, kind: 'body', textHash: 'h' }],
};
const output = {
  annotations: [
    {
      paragraphId: 'p1',
      quote: 'this may help',
      marker: 'may',
      category: 'hedges' as const,
      rationale: 'Giảm chắc chắn.',
    },
    {
      paragraphId: 'p1',
      quote: 'We think',
      marker: 'We',
      category: 'self_mention' as const,
      rationale: 'Tác giả.',
    },
    {
      paragraphId: 'p1',
      quote: 'not there at all',
      marker: 'x',
      category: 'asides' as const,
      rationale: 'r',
    },
  ],
};
const run = () =>
  buildStanceRun({
    id: '00000000-0000-4000-8000-0000000000aa',
    createdAt: '2026-01-02T00:00:00.000Z',
    model: 'm',
    promptVersion: 'v',
    callsUsed: 1,
    sectionIds: ['a'],
    chunks: planStance(paper, ['a']),
    results: { 'chunk-1': output },
  });
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
});
async function setup(seed = true, client?: LlmClient) {
  const repo: Repositories = createRepositories(createDb(`stance-ui-${crypto.randomUUID()}`));
  await repo.papers.create(paper);
  if (seed) await repo.stance.saveRun(paper.id, run());
  const onLocation = vi.fn();
  render(
    <StorageProvider repositories={repo}>
      <LlmProvider innerClient={client}>
        <PaperStance paper={paper} onLocation={onLocation} />
      </LlmProvider>
    </StorageProvider>,
  );
  return { repo, onLocation };
}

it('F4 shows counts per 1,000 words, says they are descriptive and reports discards', async () => {
  await setup();
  expect(await screen.findByText('Tổng quan giọng văn')).toBeInTheDocument();
  expect(screen.getByText(/8 từ đã đọc · 2 dấu hiệu/)).toBeInTheDocument();
  expect(screen.getByRole('row', { name: /Rào đón.* 1 125/ })).toBeInTheDocument();
  expect(screen.getByText(/không phải điểm chất lượng/)).toBeInTheDocument();
  expect(screen.getByText(/1\s+đề xuất không tìm thấy trong bài/)).toBeInTheDocument();
});

it('F4 opens a category, shows the marker in its clause and links to the paper', async () => {
  const { onLocation } = await setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Rào đón (Hedges)' }));
  expect(screen.getByRole('heading', { name: 'Rào đón (Hedges)' })).toBeInTheDocument();
  expect(screen.getByText('may').tagName).toBe('MARK');
  expect(screen.getByText('Giảm chắc chắn.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tr. 2 · Results' }));
  expect(onLocation).toHaveBeenCalledWith({ paragraphId: 'p1', start: 14, end: 17 });
});

it('F4 confirms, dismisses and undoes, and dismissing changes the count', async () => {
  const { repo } = await setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Rào đón (Hedges)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Loại bỏ' }));
  expect(await screen.findByText('Đã loại')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('treeitem', { name: /Lập trường/ })).toHaveTextContent('1'));
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  expect(await screen.findByText('Đã xác nhận')).toBeInTheDocument();
  const record = await repo.stance.get(paper.id);
  expect(record?.decisions.map((item) => item.decision)).toEqual(['dismiss', 'reopen', 'confirm']);
  expect(record?.runs[0]?.annotations).toHaveLength(2);
});

it('F4 runs an analysis with an estimate', async () => {
  acceptConsent(getConfig(), true);
  const completeJson = vi.fn(async (options: { onRequest?: () => Promise<void> }) => {
    await options.onRequest?.();
    return { data: output, meta: { model: 'm', promptVersion: 'p', latencyMs: 1, repaired: false } };
  });
  await setup(false, { completeJson } as unknown as LlmClient);
  expect(await screen.findByText(/Ước tính 1 lượt gọi/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu phân tích' }));
  expect(await screen.findByText('Tổng quan giọng văn')).toBeInTheDocument();
  expect(completeJson).toHaveBeenCalledTimes(1);
});
