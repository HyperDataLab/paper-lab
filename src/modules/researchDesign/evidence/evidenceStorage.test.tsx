import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { fixturePaper, fixtureRun } from '@/core/measurement/testFixture';
import { ResearchDesignSchema } from '@/core/schemas/researchDesign';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import { ResearchDesignProvider } from '../ResearchDesignProvider';
import EvidenceSection from '../sections/EvidenceSection';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
const id = '00000000-0000-4000-8000-000000000001';
const at = '2026-01-01T00:00:00.000Z';

it('M6 stores a decision on a local fact through the provider, and it reads back after a reload', async () => {
  const repo = createRepositories(createDb(`evidence-${crypto.randomUUID()}`));
  const project = await repo.extraction.save({
    schemaVersion: 1,
    id,
    paperId: null,
    title: 'Synthetic',
    researchQuestion: '',
    createdAt: at,
    updatedAt: at,
    papers: [
      {
        key: 'project-paper',
        source: { kind: 'paper', paperId: fixturePaper.id },
        title: 'Synthetic paper',
        authors: [],
        year: null,
        venue: null,
        doi: null,
        access: 'FULL_TEXT',
        abstract: null,
        revision: '1',
        screening: 'included',
      },
    ],
    fields: [],
    runs: [],
    cells: [],
    deep: null,
  });
  await repo.papers.create(fixturePaper);
  await repo.measurements.saveRun(fixturePaper.id, fixtureRun());
  const tree = () => (
    <MemoryRouter>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson: vi.fn() }}>
          <ToastProvider>
            <ResearchDesignProvider project={project}>
              <EvidenceSection />
            </ResearchDesignProvider>
          </ToastProvider>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>
  );
  const view = render(tree());
  const [checkbox] = await screen.findAllByRole('checkbox', { name: /^Chọn / });
  fireEvent.click(checkbox!);
  fireEvent.click(screen.getByRole('button', { name: 'Dùng' }));
  await waitFor(async () => expect((await repo.researchDesigns.get(id))?.version).toBe(1));
  const record = ResearchDesignSchema.parse(await repo.researchDesigns.get(id));
  const decisions = Object.values(record.facts['project-paper']?.decisions ?? {});
  expect(decisions).toEqual([{ decision: 'use', reason: null, by: 'local', at: expect.any(String) }]);
  view.unmount();
  render(tree());
  expect(await screen.findAllByText('Dùng', { selector: 'span' })).toHaveLength(1);
});
