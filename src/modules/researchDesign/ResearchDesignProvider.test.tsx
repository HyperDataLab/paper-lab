import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { ExtractionProject } from '@/core/schemas';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { ResearchDesignProvider, useResearchDesign } from './ResearchDesignProvider';

it('M2 provides loading followed by the project and its empty design', async () => {
  const at = '2026-01-01T00:00:00.000Z';
  const project: ExtractionProject = {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000001',
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
  const repo = createRepositories(createDb(`provider-${crypto.randomUUID()}`));
  function Consumer() {
    const state = useResearchDesign();
    if (state.loading) return <p>Loading</p>;
    if (state.error) return <p>Error</p>;
    return (
      <p>
        {state.project.title}: {state.design.version}
      </p>
    );
  }
  render(
    <StorageProvider repositories={repo}>
      <ResearchDesignProvider project={project}>
        <Consumer />
      </ResearchDesignProvider>
    </StorageProvider>,
  );
  expect(screen.getByText('Loading')).toBeInTheDocument();
  expect(await screen.findByText('Synthetic project: 0')).toBeInTheDocument();
});
