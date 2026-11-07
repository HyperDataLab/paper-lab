import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { buildGeneration } from '@/core/generation';
import type { LlmClient } from '@/shared/llm/client';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import Evaluate from '../evaluate/Page';
import History from '../history/Page';
import Generate from './Page';
import { GenerationResult } from './GenerationResult';

it('WR-01 WR-08 validates, asks consent, displays provenance and confirms before opening Evaluate', async () => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  const db = createDb(`generate-ui-${crypto.randomUUID()}`);
  const repo = createRepositories(db);
  const completeJson = vi.fn(async (options: Parameters<LlmClient['completeJson']>[0]) => ({
    data: options.schema.parse({
      paragraph: 'Growth improved by 9 percent.',
      sentences: [
        {
          text: 'Growth improved by 9 percent.',
          role: 'topic_sentence',
          evidenceIds: ['e1'],
          usesClaim: true,
        },
      ],
      needsEvidence: [{ note: 'Cần số liệu' }],
    }),
    meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
  })) as LlmClient['completeJson'];
  const view = render(
    <MemoryRouter initialEntries={['/generate']}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson }}>
          <Routes>
            <Route path="/generate" element={<Generate />} />
            <Route path="/evaluate" element={<Evaluate />} />
            <Route path="/history" element={<History />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Soạn đoạn (AI)' }));
  expect(screen.getByLabelText('Luận điểm chính')).toHaveAccessibleDescription('Hãy nhập luận điểm.');
  expect(screen.getByLabelText('Nội dung e1')).toHaveAccessibleDescription('Hãy nhập bằng chứng.');
  expect(completeJson).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Luận điểm chính'), { target: { value: 'Growth improved' } });
  fireEvent.change(screen.getByLabelText('Nội dung e1'), { target: { value: 'Growth improved' } });
  fireEvent.click(screen.getByRole('button', { name: 'Thêm bằng chứng' }));
  fireEvent.change(screen.getByLabelText('Nội dung e2'), { target: { value: 'Other evidence' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lên e2' }));
  fireEvent.click(screen.getByRole('button', { name: 'Soạn đoạn (AI)' }));
  expect(completeJson).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Đồng ý và tiếp tục' }));
  expect(await screen.findByText('Câu chủ đề')).toBeInTheDocument();
  const chip = screen.getByRole('button', { name: 'Bằng chứng e1' });
  fireEvent.mouseEnter(chip);
  expect(screen.getByLabelText('Nội dung e1').closest('div[class*="evidence"]')).toHaveAttribute(
    'class',
    expect.stringContaining('highlighted'),
  );
  expect(screen.getByText('Cần kiểm tra nguồn')).toBeInTheDocument();
  expect(screen.getByText('Cần số liệu')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Dùng đoạn này' }));
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByText(/Số liệu từ đầu vào/)).toBeInTheDocument();
  expect((await repo.analyses.list()).items).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận dùng đoạn' }));
  expect(await screen.findByRole('link', { name: 'Đoạn soạn từ luận điểm' })).toHaveAttribute(
    'href',
    expect.stringContaining('/generate?id='),
  );
  const list = await repo.analyses.list();
  expect(list.items).toHaveLength(1);
  view.unmount();
  render(
    <MemoryRouter initialEntries={['/history']}>
      <StorageProvider repositories={repo}>
        <History />
      </StorageProvider>
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(screen.getByRole('link', { name: 'Growth improved' })).toHaveAttribute(
      'href',
      expect.stringContaining('/generate?id='),
    ),
  );
  await db.delete();
});

it('WR-06 WR-08 requires an override when the draft drops a negation', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const db = createDb(`generate-negation-${crypto.randomUUID()}`);
  const repo = createRepositories(db);
  const generation = buildGeneration(
    {
      mainClaim: 'Treatment affects growth',
      evidence: [{ id: 'e1', text: 'The treatment did not improve growth.', citation: null }],
      audience: 'general',
      structure: 'auto',
      preserveTerms: [],
      hedging: 'keep_as_given',
    },
    {
      paragraph: 'The treatment improved growth.',
      sentences: [
        { text: 'The treatment improved growth.', role: 'development', evidenceIds: ['e1'], usesClaim: true },
      ],
      needsEvidence: [],
    },
    { id: crypto.randomUUID(), model: 'fake', createdAt: new Date().toISOString() },
  );
  expect(
    generation.checks.overall.filter((check) => check.status === 'fail').map((check) => check.id),
  ).toEqual(['negation_preserved']);
  await repo.generations.create(generation);
  await expect(repo.generations.acceptGeneration(generation.id)).rejects.toThrow('failed provenance');
  const view = render(
    <MemoryRouter initialEntries={[`/generate?id=${generation.id}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider>
          <Generate />
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Dùng đoạn này' }));
  expect(within(screen.getByRole('alertdialog')).getByText(/Giữ nguyên phủ định/)).toBeInTheDocument();
  expect((await repo.analyses.list()).items).toHaveLength(0);
  view.unmount();
  await db.delete();
});

it('WR-01 lists unanchored sentences and marks the correct displayed sentence', () => {
  const generation = buildGeneration(
    {
      mainClaim: 'Growth improved',
      evidence: [{ id: 'e1', text: 'Growth improved.', citation: null }],
      audience: 'general',
      structure: 'auto',
      preserveTerms: [],
      hedging: 'keep_as_given',
    },
    {
      paragraph: 'Growth improved. Growth improved by 9 percent.',
      sentences: [
        { text: 'Missing 8 percent.', role: 'lead', evidenceIds: [], usesClaim: false },
        { text: 'Growth improved.', role: 'topic_sentence', evidenceIds: ['e1'], usesClaim: true },
        { text: 'Growth improved by 9 percent.', role: 'development', evidenceIds: ['e1'], usesClaim: false },
      ],
      needsEvidence: [],
    },
    { id: '123e4567-e89b-42d3-a456-426614174000', model: 'fake', createdAt: '2025-01-01T00:00:00.000Z' },
  );
  render(<GenerationResult generation={generation} highlight={() => {}} />);
  expect(screen.getByText(/Missing 8 percent/)).toBeInTheDocument();
  expect(screen.getByText('Growth improved.')).not.toHaveAttribute('class');
  expect(screen.getByText('Growth improved by 9 percent.')).toHaveAttribute(
    'class',
    expect.stringContaining('critical'),
  );
});
