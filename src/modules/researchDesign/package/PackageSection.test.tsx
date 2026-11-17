import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyDraft } from '@/core/researchDesign/draft/schema';
import { examplePlan } from '@/core/researchDesign/plan/examplePlan';
import { emptyResearchDesign, type ResearchDesign } from '@/core/schemas/researchDesign';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import PackageSection from '../sections/PackageSection';

const mock = vi.hoisted(() => ({
  complete: false,
  frozen: false,
  published: false,
  freeze: vi.fn(),
  update: vi.fn(),
}));
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
        publishedPlans: mock.published ? { '1': { publishedAt: '2026-01-01T00:00:00.000Z' } } : undefined,
      },
      bank: null,
      papers: { schemaVersion: 1, papers: [], log: [] },
      project: { id: 'project', title: 'Synthetic project' },
      save: vi.fn(),
      update: mock.update,
      freeze: mock.freeze,
      reload: vi.fn(),
    }),
  };
});

const signedIn: AuthValue = {
  user: { uid: 'u-1', email: 'tester@example.test', name: null },
  ready: true,
  error: '',
  signIn: async () => {},
  signOut: async () => {},
  getIdToken: async () => 'test-token',
};
function show(auth?: AuthValue) {
  const page = (
    <MemoryRouter>
      <ToastProvider>
        <PackageSection />
      </ToastProvider>
    </MemoryRouter>
  );
  return render(auth ? <AuthContext.Provider value={auth}>{page}</AuthContext.Provider> : page);
}
const frozenRecord = () => ({ ...emptyResearchDesign('project'), frozenPlans: [examplePlan()] });

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
  mock.freeze.mockResolvedValue(frozenRecord());
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

describe('publishing frozen plans for SRD', () => {
  afterEach(() => {
    Object.assign(mock, { complete: false, frozen: false, published: false });
    mock.freeze.mockReset();
    mock.update.mockReset();
    vi.unstubAllGlobals();
  });
  const freezeVersion1 = () => {
    fireEvent.click(screen.getByRole('button', { name: /phi.n b.n 1/ }));
    fireEvent.click(screen.getByRole('button', { name: /^..ng b.ng$/i }));
  };
  const appliedUpdate = () => {
    const change = mock.update.mock.calls[0]?.[0] as (design: ResearchDesign) => ResearchDesign;
    return change(frozenRecord()).publishedPlans;
  };

  it('SRD-PUB-01 publishes the stored plan right after freezing and records it', async () => {
    mock.complete = true;
    mock.freeze.mockResolvedValue(frozenRecord());
    mock.update.mockImplementation(async (change: (d: ResearchDesign) => ResearchDesign) =>
      change(frozenRecord()),
    );
    const fetchMock = vi.fn(async () => Response.json({ projectId: 'project', version: 1 }, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    show(signedIn);
    freezeVersion1();
    expect(await screen.findByText('Đã gửi phiên bản 1 lên máy chủ lab cho SRD.')).toHaveAttribute(
      'role',
      'status',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/projects/project/plans/1?title='),
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(examplePlan()) }),
    );
    expect(Object.keys(appliedUpdate() ?? {})).toEqual(['1']);
  });

  it('SRD-PUB-02 freezes without sending when signed out', async () => {
    mock.complete = true;
    mock.freeze.mockResolvedValue(frozenRecord());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    show();
    freezeVersion1();
    expect(await screen.findByText('Chưa gửi lên máy chủ lab (cần đăng nhập).')).toBeInTheDocument();
    expect(mock.freeze).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled();
  });

  it.each([
    ['a server error', async () => new Response(null, { status: 503 }), 'lỗi 503'],
    ['a conflict', async () => new Response(null, { status: 409 }), 'nội dung khác'],
    [
      'no connection',
      async () => Promise.reject(new TypeError('Failed to fetch')),
      'Không kết nối được máy chủ lab',
    ],
  ])('SRD-PUB-03 keeps the frozen version and shows the reason after %s', async (_, answer, reason) => {
    mock.complete = true;
    mock.freeze.mockResolvedValue(frozenRecord());
    vi.stubGlobal('fetch', vi.fn(answer));
    show(signedIn);
    freezeVersion1();
    const alert = await screen.findByText(/Chưa gửi được phiên bản 1 lên máy chủ lab/);
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(reason);
    expect(await screen.findByText('Đã đóng băng phiên bản 1.')).toBeInTheDocument();
    expect(screen.queryByText(/Không đóng băng được/)).not.toBeInTheDocument();
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('SRD-PUB-04 resends a version that is not on the server yet', async () => {
    mock.frozen = true;
    mock.update.mockResolvedValue(frozenRecord());
    const fetchMock = vi.fn(async () => Response.json({ projectId: 'project', version: 1 }, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    show(signedIn);
    expect(screen.getByText('Chưa gửi lên máy chủ lab')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lên máy chủ lab' }));
    expect(await screen.findByText('Đã gửi phiên bản 1 lên máy chủ lab cho SRD.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(appliedUpdate() ?? {})).toEqual(['1']);
  });

  it('SRD-PUB-05 treats an unchanged answer as sent', async () => {
    mock.frozen = true;
    mock.update.mockResolvedValue(frozenRecord());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ unchanged: true })),
    );
    show(signedIn);
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lên máy chủ lab' }));
    expect(await screen.findByText('Phiên bản 1 đã có sẵn trên máy chủ lab cho SRD.')).toHaveAttribute(
      'role',
      'status',
    );
    expect(Object.keys(appliedUpdate() ?? {})).toEqual(['1']);
  });

  it('SRD-PUB-06 shows sent versions without a send button and disables it when signed out', () => {
    mock.frozen = true;
    mock.published = true;
    const { unmount } = show(signedIn);
    expect(screen.getByText('Đã có trên máy chủ lab')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gửi lên máy chủ lab' })).not.toBeInTheDocument();
    unmount();
    mock.published = false;
    show();
    expect(screen.getByRole('button', { name: 'Gửi lên máy chủ lab' })).toBeDisabled();
    expect(screen.getByText('Chưa gửi lên máy chủ lab (cần đăng nhập).')).toBeInTheDocument();
  });
});
