import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { sentenceIndex } from '@/core/paperModel';
import type { Paper } from '@/core/schemas';
import type { LlmClient } from '@/shared/llm/client';
import { getConfig } from '@/shared/llm/config';
import { acceptConsent } from '@/shared/llm/consent';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { PaperContribution } from './PaperContribution';

it('R17e shows a contribution unit and a verified triple', async () => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  acceptConsent(getConfig(), true);
  const at = '2026-01-01T00:00:00.000Z';
  const paper: Paper = {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000002',
    title: 'Synthetic',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: 1, sha256: '' },
    sections: [{ id: 's', heading: 'Intro', role: 'introduction', level: 1, pageStart: 1 }],
    paragraphs: [
      {
        id: 'p',
        sectionId: 's',
        order: 0,
        kind: 'body',
        text: 'We propose a model.',
        pageStart: 1,
        textHash: '',
      },
    ],
  };
  const repo = createRepositories(createDb(`contribution-${crypto.randomUUID()}`));
  await repo.papers.create(paper);
  const completeJson = vi.fn(async (request: Parameters<LlmClient['completeJson']>[0]) => {
    await request.onRequest?.();
    return {
      data: request.schema.parse({
        domain: 'ml_nlp',
        sentences: [
          {
            sentenceId: sentenceIndex(paper)[0]?.key,
            unit: 'Model',
            phrases: ['We', 'propose', 'a model'],
            triples: [{ subject: 'We', predicate: 'propose', object: 'a model', unit: 'Model' }],
          },
        ],
      }),
      meta: { model: 'm', promptVersion: request.promptVersion, latencyMs: 1, repaired: false },
    };
  });
  render(
    <StorageProvider repositories={repo}>
      <LlmProvider innerClient={{ completeJson } as unknown as LlmClient}>
        <PaperContribution paper={paper} onLocation={vi.fn()} />
      </LlmProvider>
    </StorageProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Phân tích contribution' }));
  expect(await screen.findByRole('heading', { name: 'Model' })).toBeInTheDocument();
  expect(screen.getByText('We → propose → a model')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Đồ thị tri thức' }));
  fireEvent.click(screen.getByRole('button', { name: 'We' }));
  expect(screen.getByText('We propose a model.')).toBeVisible();
  expect(screen.getByText('We → propose → a model')).toBeVisible();
  fireEvent.click(screen.getByRole('radio', { name: 'Dòng contribution' }));
  expect(screen.getByRole('heading', { name: 'Model' })).toBeInTheDocument();
});
