import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { emptyResearchDesign } from '@/core/schemas/researchDesign';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { ResearchDesignProvider } from '../ResearchDesignProvider';
import AnalysesSection from '../sections/AnalysesSection';
import RunsSection from '../sections/RunsSection';

async function setup(section: 'analyses' | 'runs') {
  const repo = createRepositories(createDb(`sections-${crypto.randomUUID()}`));
  const id = crypto.randomUUID();
  const at = '2026-01-01T00:00:00.000Z';
  const project = await repo.extraction.save({
    schemaVersion: 1,
    id,
    paperId: null,
    title: 'Synthetic',
    researchQuestion: '',
    createdAt: at,
    updatedAt: at,
    papers: [],
    fields: [],
    runs: [],
    cells: [],
    deep: null,
  });
  const record = emptyResearchDesign(id);
  record.draft.hypotheses.push({
    id: 'h-1',
    statement: 'Invented hypothesis',
    kind: 'directional',
    question: null,
    claim: null,
    independent: [],
    dependent: ['v-1'],
  });
  record.draft.variables.push({
    id: 'v-1',
    name: 'Score',
    role: 'dependent',
    construct: '',
    metric: null,
    levels: [],
  });
  record.draft.conditions.push({ id: 'c-1', name: 'Control', baseline: true, params: {} });
  record.draft.datasets.push({
    id: 'd-1',
    name: 'Sample',
    source: 'Invented',
    version: null,
    split: null,
    sha256: null,
    benchmark: null,
  });
  await repo.researchDesigns.save(record, 0);
  render(
    <StorageProvider repositories={repo}>
      <ResearchDesignProvider project={project}>
        <MemoryRouter>{section === 'analyses' ? <AnalysesSection /> : <RunsSection />}</MemoryRouter>
      </ResearchDesignProvider>
    </StorageProvider>,
  );
  return { repo, id };
}
it('AS-01 and AS-04 save dependent variables and reject invalid alpha', async () => {
  const { repo, id } = await setup('analyses');
  fireEvent.click((await screen.findAllByRole('button', { name: 'Thêm phân tích' }))[0]!);
  expect(screen.getByLabelText('v-1 Score')).toBeChecked();
  fireEvent.click(screen.getByRole('combobox', { name: 'Phương pháp' }));
  fireEvent.click(screen.getByRole('option', { name: /ANOVA một nhân tố/ }));

  fireEvent.change(screen.getByLabelText('α'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  expect(screen.getByText('α phải là số lớn hơn 0 và nhỏ hơn 1.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('α'), { target: { value: '0.05' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(async () =>
    expect((await repo.researchDesigns.get(id))?.draft.analyses[0]).toMatchObject({
      variables: ['v-1'],
      method: 'anova_oneway',
    }),
  );
});
it('RN-01, RN-03 and RN-04 validate seeds and count saved runs', async () => {
  const { repo, id } = await setup('runs');
  fireEvent.click(await screen.findByLabelText(/c-1 Control/));
  fireEvent.click(screen.getByLabelText(/d-1 Sample/));
  fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '-1' } });
  expect(screen.getByRole('button', { name: 'Lưu lưới' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '0-200' } });
  expect(screen.getByText('Tối đa 200 seed.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '0-4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu lưới' }));
  expect(await screen.findByText('1 điều kiện × 1 dataset × 5 seed = 5 lần chạy')).toBeInTheDocument();
  expect((await repo.researchDesigns.get(id))?.draft.runMatrix.seeds).toEqual([0, 1, 2, 3, 4]);
});
