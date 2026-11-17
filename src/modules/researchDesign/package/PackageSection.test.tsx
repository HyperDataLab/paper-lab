import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { emptyDraft } from '@/core/researchDesign/draft/schema';
import { examplePlan } from '@/core/researchDesign/plan/examplePlan';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import PackageSection from '../sections/PackageSection';

const mock = vi.hoisted(() => ({ complete: false, frozen: false, freeze: vi.fn() }));
vi.mock('../ResearchDesignProvider', async () => {
  const { emptyResearchDesign } = await import('@/core/schemas/researchDesign');
  return {
    useResearchDesign: () => ({
      loading: false,
      error: null,
      design: {
        ...emptyResearchDesign('project'),
        draft: mock.complete ? complete() : emptyResearchDesign('project').draft,
        frozenPlans: mock.frozen ? [examplePlan()] : [],
      },
      bank: null,
      papers: { schemaVersion: 1, papers: [], log: [] },
      project: { id: 'project', title: 'Synthetic project' },
      save: vi.fn(),
      freeze: mock.freeze,
      reload: vi.fn(),
    }),
  };
});

function complete() {
  const d = emptyDraft();
  d.questions = [{ id: 'q-1', text: 'Question', gap: 'Gap', papers: [] }];
  d.hypotheses = [
    {
      id: 'h-1',
      statement: 'Hypothesis',
      kind: 'exploratory',
      question: 'q-1',
      claim: null,
      independent: [],
      dependent: ['v-1'],
    },
  ];
  d.variables = [
    { id: 'v-1', name: 'Variable', role: 'dependent', construct: 'Construct', metric: 'm-1', levels: [] },
  ];
  d.metrics = [
    {
      id: 'm-1',
      name: 'Metric',
      key: 'score',
      unit: 'points',
      goal: 'maximize',
      aggregation: 'mean',
      protocol: 'Measure',
      bank: null,
      protocolBank: null,
    },
  ];
  d.datasets = [
    {
      id: 'd-1',
      name: 'Dataset',
      source: 'Source',
      version: null,
      split: null,
      sha256: null,
      benchmark: null,
    },
  ];
  d.conditions = [{ id: 'c-1', name: 'Condition', baseline: true, params: {} }];
  d.runMatrix = {
    mlflowExperiment: 'Experiment',
    conditions: ['c-1'],
    datasets: ['d-1'],
    seeds: [1],
    sampleSizeJustification: 'Prior work',
  };
  return d;
}
it('PK-01 shows missing items as links and blocks freezing', () => {
  render(
    <MemoryRouter>
      <ToastProvider>
        <PackageSection />
      </ToastProvider>
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: /gi.*thuy/ })).toHaveAttribute('href', '/?design=questions');
  expect(screen.getByRole('button', { name: /phi.n b.n 1/ })).toBeDisabled();
});

it('PK-02 displays ten rules and freezes the draft', async () => {
  mock.complete = true;
  mock.freeze.mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <ToastProvider>
        <PackageSection />
      </ToastProvider>
    </MemoryRouter>,
  );
  expect(screen.getAllByText(/^PP-\d\d$/)).toHaveLength(10);
  fireEvent.click(screen.getByRole('button', { name: /phi.n b.n 1/ }));
  fireEvent.click(screen.getByRole('button', { name: /^..ng b.ng$/i }));
  await waitFor(() =>
    expect(mock.freeze).toHaveBeenCalledWith(1, 'local', null, expect.anything(), expect.any(String)),
  );
  mock.complete = false;
});
it('PK-08 RS offers runner stubs from a frozen plan', () => {
  mock.frozen = true;
  render(
    <MemoryRouter>
      <ToastProvider>
        <PackageSection />
      </ToastProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: /runner/ }));
  expect(screen.getByText('tag_run.py')).toBeInTheDocument();
  expect(screen.getByText('plan_grid.yaml')).toBeInTheDocument();
  expect(screen.getByText('plan_sweep.yaml')).toBeInTheDocument();
  mock.frozen = false;
});
