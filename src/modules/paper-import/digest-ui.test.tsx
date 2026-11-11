import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Paper } from '@/core/schemas';
import type { LlmClient } from '@/shared/llm/client';
import { getConfig } from '@/shared/llm/config';
import { acceptConsent } from '@/shared/llm/consent';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { PaperDigest } from './PaperDigest';
import { PaperSnapshot } from './PaperSnapshot';

const at = '2026-01-01T00:00:00.000Z';
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-0000000000e2',
  title: 'Synthetic',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'text', fileName: '', pageCount: 2, sha256: '' },
  sections: [
    { id: 'i', heading: 'Introduction', role: 'introduction', level: 1, pageStart: 1 },
    { id: 'r', heading: 'Results', role: 'results', level: 1, pageStart: 2 },
  ],
  paragraphs: [
    {
      id: 'i1',
      sectionId: 'i',
      order: 0,
      kind: 'body',
      text: 'Sharing data may help.',
      pageStart: 1,
      textHash: '',
    },
    {
      id: 'r1',
      sectionId: 'r',
      order: 1,
      kind: 'body',
      text: 'Shared trials received 69% more citations.',
      pageStart: 2,
      textHash: '',
    },
  ],
};
const output = {
  headline: 'Sharing data is linked with more citations.',
  overview: { text: 'The study asks whether sharing data pays off.', refs: ['i1'] },
  sections: [
    {
      heading: 'Results',
      blocks: [
        {
          text: 'The main findings:',
          refs: ['r1'],
          items: [
            { lead: 'Citations', text: '69% more for trials that shared data', refs: ['r1'] },
            { lead: 'Scope', text: 'seen in 12 journals', refs: ['r1'] },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
});

it('R12 one button writes the reader summary, section by section, each part opening its page', async () => {
  acceptConsent(getConfig(), true);
  const repo = createRepositories(createDb(`digest-${crypto.randomUUID()}`));
  await repo.papers.create(paper);
  const completeJson = vi.fn(async (request: Parameters<LlmClient['completeJson']>[0]) => {
    await request.onRequest?.();
    return {
      data: request.schema.parse(output),
      meta: { model: 'm', promptVersion: request.promptVersion, latencyMs: 1, repaired: false },
    };
  });
  const onLocation = vi.fn();
  render(
    <StorageProvider repositories={repo}>
      <LlmProvider innerClient={{ completeJson } as unknown as LlmClient}>
        <PaperDigest paper={paper} onLocation={onLocation} />
      </LlmProvider>
    </StorageProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Tóm tắt bài (AI)' }));
  const confirm = await screen.findByRole('button', { name: 'Đồng ý và tiếp tục' }).catch(() => null);
  if (confirm) fireEvent.click(confirm);
  expect(
    await screen.findByRole('heading', { name: 'Sharing data is linked with more citations.' }),
  ).toBeInTheDocument();
  expect(completeJson).toHaveBeenCalledTimes(1);
  const results = screen.getByRole('region', { name: 'Results' });
  expect(within(results).getByText('Citations:')).toBeInTheDocument();
  // A number that is not in the cited paragraph is shown, but marked.
  const scope = within(results)
    .getByText(/seen in 12 journals/)
    .closest('li') as HTMLElement;
  expect(within(scope).getByText('Số chưa đối chiếu được')).toBeInTheDocument();
  fireEvent.click(within(results).getAllByRole('button', { name: 'Tr. 2' })[0] as HTMLElement);
  expect(onLocation).toHaveBeenCalledWith({ paragraphId: 'r1', start: 0, end: 42 });
  // The summary is kept: it is read back next time, and can be written again.
  expect((await repo.paperInsights.get(paper.id))?.digestRuns).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Tóm tắt lại' })).toBeInTheDocument();
});

it('R13 key facts sit above the summary as a strip, each with its page, and a rejected fact leaves', async () => {
  const repo = createRepositories(createDb(`facts-${crypto.randomUUID()}`));
  await repo.papers.create(paper);
  await repo.paperInsights.saveSnapshotRun(paper.id, {
    id: '00000000-0000-4000-8000-0000000000f1',
    createdAt: at,
    model: 'm',
    promptVersion: 'snapshot-1',
    callsUsed: 1,
    sectionIds: ['r'],
    values: [
      {
        id: 'snap-results',
        field: 'results',
        status: 'reported',
        value: '69% more citations',
        source: { paragraphId: 'r1', sectionId: 'r', page: 2, start: 0, end: 13, excerpt: 'Shared trials' },
      },
      { id: 'snap-duration', field: 'duration', status: 'not_reported', value: null, source: null },
    ],
  });
  const onLocation = vi.fn();
  render(
    <StorageProvider repositories={repo}>
      <LlmProvider innerClient={{ completeJson: vi.fn() } as unknown as LlmClient}>
        <PaperSnapshot compact paper={paper} onLocation={onLocation} />
      </LlmProvider>
    </StorageProvider>,
  );
  const strip = await screen.findByRole('region', { name: 'Key facts' });
  // Only what the paper states is shown; a field it does not state takes no room.
  expect(within(strip).getByText('Results')).toBeInTheDocument();
  expect(within(strip).queryByText('Duration')).toBeNull();
  fireEvent.click(within(strip).getByRole('button', { name: 'Tr. 2' }));
  expect(onLocation).toHaveBeenCalledWith({ paragraphId: 'r1', start: 0, end: 13 });
  fireEvent.click(within(strip).getByRole('button', { name: 'Bác bỏ Results' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Key facts' })).toBeNull());
});
