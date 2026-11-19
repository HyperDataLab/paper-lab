import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ExtractionProject } from '@/core/schemas';
import type { ResearchDesign } from '@/core/schemas/researchDesign';
import { snapshot } from '@/core/researchDesign/bank/testSupport';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { ResearchDesignConflictError } from '@/shared/storage/errors';
import { ResearchDesignProvider, useResearchDesign } from './ResearchDesignProvider';
import { SectionBody } from './SectionBody';
import BankSection from './sections/BankSection';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

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
const auth: AuthValue = {
  user: { uid: 'u-1', email: 'tester@example.org', name: null },
  ready: true,
  error: '',
  signIn: async () => {},
  signOut: async () => {},
  getIdToken: async () => 'token',
};
const retitle = (title: string) => (design: ResearchDesign) => ({
  ...design,
  draft: { ...design.draft, planTitle: title },
});

type Ready = Extract<ReturnType<typeof useResearchDesign>, { error: null; loading: false }>;
const seen: { state: ReturnType<typeof useResearchDesign> | null } = { state: null };
function Consumer() {
  const state = useResearchDesign();
  useEffect(() => {
    seen.state = state;
  });
  if (state.loading) return <p>Loading</p>;
  if (state.error) return <p>Error</p>;
  return (
    <p>
      {state.project.title}: {state.design.version} {state.design.draft.planTitle}
    </p>
  );
}
function ready(): Ready {
  const state = seen.state;
  if (!state || state.loading || state.error) throw new Error('not ready');
  return state;
}

async function setup(withBank = false) {
  const repo = createRepositories(createDb(`provider-${crypto.randomUUID()}`));
  await repo.extraction.save(project);
  const view = render(
    <StorageProvider repositories={repo}>
      <AuthContext.Provider value={auth}>
        <ResearchDesignProvider project={project}>
          <Consumer />
          {withBank && <BankSection />}
        </ResearchDesignProvider>
      </AuthContext.Provider>
    </StorageProvider>,
  );
  await screen.findByText(/^Synthetic project: 0/);
  return { repo, view };
}

it('M2 provides loading followed by the project and its empty design', async () => {
  const repo = createRepositories(createDb(`provider-${crypto.randomUUID()}`));
  render(
    <StorageProvider repositories={repo}>
      <ResearchDesignProvider project={project}>
        <Consumer />
      </ResearchDesignProvider>
    </StorageProvider>,
  );
  expect(screen.getByText('Loading')).toBeInTheDocument();
  expect(await screen.findByText(/^Synthetic project: 0/)).toBeInTheDocument();
});

it('RD-PROV-01 re-applies a change once after a version conflict', async () => {
  const { repo } = await setup();
  const save = vi.spyOn(repo.researchDesigns, 'save');
  save.mockRejectedValueOnce(new ResearchDesignConflictError('Research design changed'));
  const change = vi.fn(retitle('Retried'));
  await act(() => ready().update(change));
  expect(change).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenCalledTimes(2);
  expect((await repo.researchDesigns.get(project.id))?.draft.planTitle).toBe('Retried');
  expect(await screen.findByText('Synthetic project: 1 Retried')).toBeInTheDocument();
});

it('RD-PROV-02 surfaces a second conflict and leaves the state alone', async () => {
  const { repo } = await setup();
  vi.spyOn(repo.researchDesigns, 'save')
    .mockRejectedValueOnce(new ResearchDesignConflictError('Research design changed'))
    .mockRejectedValueOnce(new ResearchDesignConflictError('Research design changed'));
  await act(async () => {
    await expect(ready().update(retitle('Lost'))).rejects.toBeInstanceOf(ResearchDesignConflictError);
  });
  expect(ready().design.version).toBe(0);
  expect(await repo.researchDesigns.get(project.id)).toBeUndefined();
});

it('RD-PROV-03 lets another section save after a bank import without a remount', async () => {
  const { repo, view } = await setup(true);
  await screen.findByText('Chưa có bản chụp');
  const text = JSON.stringify(snapshot);
  const file = new File([text], 'bank.json');
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
  });
  const input = view.container.querySelector('input[type=file]');
  if (!input) throw new Error('no file input');
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByText(/^sha256:/)).toBeInTheDocument();
  expect(ready().design.version).toBe(1);
  expect(ready().bank?.release).toMatch(/^sha256:/);
  await act(() => ready().update(retitle('After import')));
  const stored = await repo.researchDesigns.get(project.id);
  expect(stored).toMatchObject({ version: 2, draft: { planTitle: 'After import' } });
  expect(stored?.bankRelease).toMatch(/^sha256:/);
  await act(() => ready().save(retitle('Old signature')));
  expect((await repo.researchDesigns.get(project.id))?.draft.planTitle).toBe('Old signature');
});

it('RD-PROV-04 reload picks up a change written elsewhere', async () => {
  const { repo } = await setup();
  const base = ready().design;
  await repo.researchDesigns.save(retitle('External')(base), base.version);
  expect(ready().design.version).toBe(0);
  await act(() => ready().reload());
  expect(await screen.findByText('Synthetic project: 1 External')).toBeInTheDocument();
});

it('RD-PROV-05 shows Thử lại on a load error and loads again', async () => {
  const repo = createRepositories(createDb(`provider-${crypto.randomUUID()}`));
  await repo.extraction.save(project);
  vi.spyOn(repo.researchDesigns, 'get').mockRejectedValueOnce(new Error('unreadable'));
  render(
    <StorageProvider repositories={repo}>
      <ResearchDesignProvider project={project}>
        <SectionBody section={Consumer} />
      </ResearchDesignProvider>
    </StorageProvider>,
  );
  expect(await screen.findByText('Không tải được research design.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await waitFor(() => expect(screen.getByText(/^Synthetic project: 0/)).toBeInTheDocument());
});
