import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { sentenceIndex } from '@/core/paperModel';
import type { Paper } from '@/core/schemas';
import type { LlmClient } from '@/shared/llm/client';
import { getConfig } from '@/shared/llm/config';
import { acceptConsent } from '@/shared/llm/consent';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { PaperScg } from './PaperScg';
import { testRepositories } from '@/shared/storage/testRepositories';

it('SCG lists a run with prerequisites and quotes, and saves accept and reject', async () => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  acceptConsent(getConfig(), true);
  const at = '2026-01-01T00:00:00.000Z';
  const paper: Paper = {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000003',
    title: 'Synthetic',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: 1, sha256: '' },
    sections: [{ id: 's', heading: 'Method', role: 'methods', level: 1, pageStart: 1 }],
    paragraphs: [
      {
        id: 'p',
        sectionId: 's',
        order: 0,
        kind: 'body',
        text: 'We propose the Foo encoder, which builds on Bar attention.',
        pageStart: 1,
        textHash: '',
      },
    ],
  };
  const key = sentenceIndex(paper)[0]?.key ?? '';
  const repo = testRepositories();
  await repo.papers.create(paper);
  const outputs: Record<string, unknown> = {
    scg_contributions: {
      contributions: [
        {
          name: 'Foo encoder',
          description: 'An encoder for parsing.',
          types: [{ type: 'models_or_architectures', explanation: 'A new encoder.' }],
          sections: ['Method'],
          evidence: [{ sentenceKey: key, quote: 'the Foo encoder' }],
        },
      ],
    },
    scg_prerequisites: {
      prerequisites: [
        {
          contributionId: `${paper.id}.c0`,
          name: 'Bar attention',
          description: 'An attention mechanism.',
          explanation: 'Foo extends Bar attention.',
          coreOrPeripheral: 'core',
          references: [],
          internalContributionId: null,
          toolUrl: null,
          evidence: [{ sentenceKey: key, quote: 'Bar attention' }],
        },
      ],
    },
  };
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const completeJson = vi.fn(async (request: Parameters<LlmClient['completeJson']>[0]) => {
    await request.onRequest?.();
    if (request.schemaName === 'scg_prerequisites') await gate;
    return {
      data: request.schema.parse(outputs[request.schemaName]),
      meta: { model: 'm', promptVersion: request.promptVersion, latencyMs: 1, repaired: false },
    };
  });
  render(
    <StorageProvider repositories={repo}>
      <LlmProvider innerClient={{ completeJson } as unknown as LlmClient}>
        <PaperScg paper={paper} onLocation={vi.fn()} />
      </LlmProvider>
    </StorageProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Trích contribution (SCG)' }));
  // Stage 1 is shown while the pass goes on, without review controls the next checkpoint would overwrite.
  expect(await screen.findByText('Foo encoder')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Dừng' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Chấp nhận' })).toBeNull();
  release();
  expect(await screen.findByText('Bar attention')).toBeInTheDocument();
  expect(screen.getByText('Foo encoder')).toBeInTheDocument();
  expect(screen.getByText('models_or_architectures')).toBeInTheDocument();
  expect(screen.getByText('Foo extends Bar attention.')).toBeInTheDocument();
  expect(screen.getAllByText('We propose the Foo encoder, which builds on Bar attention.')).toHaveLength(2);
  expect(await screen.findByText(/Đã xong · 2 lượt gọi AI/u)).toBeInTheDocument();
  expect(completeJson).toHaveBeenCalledTimes(2);

  const [contributionCard, prerequisiteCard] = screen.getAllByRole('article');
  fireEvent.click(await within(prerequisiteCard!).findByRole('button', { name: 'Bác bỏ' }));
  await waitFor(async () =>
    expect((await repo.scg.get(paper.id))?.contributions[0]?.prerequisites[0]?.review).toBe('rejected'),
  );
  fireEvent.click(within(contributionCard!).getAllByRole('button', { name: 'Chấp nhận' })[0]!);
  await waitFor(async () =>
    expect((await repo.scg.get(paper.id))?.contributions[0]?.review).toBe('accepted'),
  );
  expect(await screen.findByText('Đã chấp nhận')).toBeInTheDocument();
  expect(screen.getByText('Đã bác bỏ')).toBeInTheDocument();
});
