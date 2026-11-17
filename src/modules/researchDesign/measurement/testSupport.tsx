import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { ExtractionProject } from '@/core/schemas';
import { contentHash } from '@/core/researchDesign/bank/release';
import { snapshot } from '@/core/researchDesign/bank/testSupport';
import { emptyDraft, type Draft } from '@/core/researchDesign/draft/schema';
import { emptyResearchDesign } from '@/core/schemas/researchDesign';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { ToastContext } from '@/shared/ui/toastContext';
import { ResearchDesignProvider } from '../ResearchDesignProvider';
import MeasurementSection from '../sections/MeasurementSection';

const id = '00000000-0000-4000-8000-000000000002';
const at = '2026-01-01T00:00:00.000Z';
const project: ExtractionProject = {
  schemaVersion: 1,
  id,
  paperId: null,
  title: 'Synthetic project',
  researchQuestion: '',
  createdAt: at,
  updatedAt: at,
  papers: [],
  fields: [],
  runs: [],
  cells: [],
  deep: null,
};
const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

export const newRepo = () => createRepositories(createDb(`measurement-${crypto.randomUUID()}`));

export function renderSection(repo: ReturnType<typeof newRepo>, url = '/') {
  const toast = vi.fn();
  render(
    <StorageProvider repositories={repo}>
      <ToastContext.Provider value={toast}>
        <ResearchDesignProvider project={project}>
          <MemoryRouter initialEntries={[url]}>
            <LlmProvider innerClient={{ completeJson: vi.fn() }}>
              <MeasurementSection />
            </LlmProvider>
          </MemoryRouter>
        </ResearchDesignProvider>
      </ToastContext.Provider>
    </StorageProvider>,
  );
  return toast;
}

/** A project with a synthetic draft and, unless `bank` is false, the synthetic snapshot pinned. */
export async function setup({ draft = emptyDraft(), bank = true, tab = '' } = {}) {
  const repo = newRepo();
  await repo.extraction.save(project);
  if (bank) {
    const raw = { ...snapshot, release: '2031.02.1' };
    const file = { ...raw, contentHash: await contentHash(raw) };
    await repo.researchDesigns.importBank(id, 0, bytes(JSON.stringify(file)), 'tester@example.org');
  }
  const record = (await repo.researchDesigns.get(id)) ?? emptyResearchDesign(id);
  await repo.researchDesigns.save({ ...record, draft }, record.version);
  const pinned = await repo.researchDesigns.getBank(id);
  const toast = renderSection(repo, `/?design=measurement${tab ? `&measure=${tab}` : ''}`);
  const stored = async () => (await repo.researchDesigns.get(id))?.draft as Draft;
  return { repo, stored, toast, release: pinned?.release ?? '' };
}

export function measurementDraft() {
  const draft = emptyDraft();
  draft.hypotheses.push({
    id: 'h-1',
    statement: 'Invented hypothesis',
    kind: 'directional',
    question: null,
    claim: null,
    independent: [],
    dependent: [],
  });
  draft.variables.push(
    {
      id: 'v-1',
      name: 'Invented factor',
      role: 'independent',
      construct: 'Invented concept',
      metric: null,
      levels: ['A', 'B'],
    },
    { id: 'v-2', name: 'Invented outcome', role: 'dependent', construct: '', metric: 'm-1', levels: [] },
    { id: 'v-3', name: 'Invented covariate', role: 'covariate', construct: '', metric: null, levels: [] },
  );
  draft.metrics.push({
    id: 'm-1',
    name: 'Invented measure',
    key: '',
    unit: '',
    goal: null,
    aggregation: null,
    protocol: '',
    bank: null,
    protocolBank: null,
  });
  draft.datasets.push({
    id: 'd-1',
    name: 'Invented data',
    source: '',
    version: null,
    split: null,
    sha256: null,
    benchmark: null,
  });
  draft.conditions.push({ id: 'c-1', name: 'Invented condition', baseline: false, params: {} });
  return draft;
}
