import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { PROMPT_VERSIONS } from '@/core/prompts';
import type { Paper } from '@/core/schemas';
import { buildStanceRun, planStance } from '@/core/stance';
import type { LlmClient } from '@/shared/llm/client';
import { getConfig } from '@/shared/llm/config';
import { acceptConsent } from '@/shared/llm/consent';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import PaperMapPage from './PaperMapPage';
import { testRepositories } from '@/shared/storage/testRepositories';

const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: 'T',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  source: { kind: 'text', fileName: 'x', pageCount: 1, sha256: 's' },
  sections: [
    { id: 'a', heading: 'Introduction', role: 'introduction', level: 1, pageStart: 1 },
    { id: 'b', heading: 'Results', role: 'results', level: 1, pageStart: 2 },
  ],
  paragraphs: [
    {
      id: 'p1',
      sectionId: 'a',
      order: 0,
      text: 'We think this may help.',
      pageStart: 1,
      kind: 'body',
      textHash: 'h1',
    },
    {
      id: 'p2',
      sectionId: 'b',
      order: 1,
      text: 'It might work in practice.',
      pageStart: 2,
      kind: 'body',
      textHash: 'h2',
    },
  ],
};
const marker = (paragraphId: string, quote: string, word: string) => ({
  paragraphId,
  quote,
  marker: word,
  category: 'hedges' as const,
  rationale: 'Giảm chắc chắn.',
});

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
});

it('R6 a section run from the section menu of a block reads only that section and keeps the other section and its decision', async () => {
  const repo = testRepositories();
  await repo.papers.create(paper);
  const config = getConfig();
  acceptConsent(config, true);
  // A finished whole-paper run with one marker in each section, and a person's decision on the first.
  const chunks = planStance(paper, ['a', 'b']);
  const first = buildStanceRun({
    id: '00000000-0000-4000-8000-0000000000aa',
    createdAt: '2026-01-02T00:00:00.000Z',
    model: config.model,
    promptVersion: PROMPT_VERSIONS.stanceEngagement,
    callsUsed: chunks.length,
    sectionIds: ['a', 'b'],
    chunks,
    results: Object.fromEntries(
      chunks.map((chunk) => [
        chunk.id,
        {
          annotations: chunk.paragraphs.some((p) => p.id === 'p1')
            ? [marker('p1', 'this may help', 'may')]
            : [marker('p2', 'It might work', 'might')],
        },
      ]),
    ),
  });
  await repo.stance.saveRun(paper.id, first);
  const kept = first.annotations.find((item) => item.sectionId === 'a');
  if (!kept) throw new Error('missing annotation');
  await repo.stance.decide(paper.id, { run_id: first.id, annotation_id: kept.id, decision: 'confirm' });

  const completeJson = vi.fn(async (options: { user: string; onRequest?: () => Promise<void> }) => {
    await options.onRequest?.();
    return {
      data: { annotations: [marker('p2', 'might work in practice', 'might')] },
      meta: {
        model: config.model,
        promptVersion: PROMPT_VERSIONS.stanceEngagement,
        latencyMs: 1,
        repaired: false,
      },
    };
  });
  render(
    <MemoryRouter initialEntries={[`/papers/${paper.id}?view=stance`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson } as unknown as LlmClient}>
          <Routes>
            <Route path="/papers/:id" element={<PaperMapPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  const block = await screen.findByRole('region', { name: 'Stance & engagement' });
  fireEvent.click(await within(block).findByRole('button', { name: 'Chạy cho một section' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: /^Results/ }));

  await waitFor(async () => expect((await repo.stance.get(paper.id))?.runs).toHaveLength(2));
  // Only the Results section was sent to the model.
  expect(completeJson).toHaveBeenCalledTimes(1);
  const sent = completeJson.mock.calls[0]?.[0].user ?? '';
  expect(sent).toContain('It might work in practice.');
  expect(sent).not.toContain('We think this may help.');
  const record = await repo.stance.get(paper.id);
  const merged = record?.runs.at(-1);
  expect(merged?.sectionIds).toEqual(['a', 'b']);
  expect(merged?.annotations.map((item) => [item.sectionId, item.marker])).toEqual([
    ['a', 'may'],
    ['b', 'might'],
  ]);
  // The decision on the kept Introduction marker now holds on the merged run as well.
  expect(
    record?.decisions.some(
      (item) => item.run_id === merged?.id && item.annotation_id === kept.id && item.decision === 'confirm',
    ),
  ).toBe(true);
});
