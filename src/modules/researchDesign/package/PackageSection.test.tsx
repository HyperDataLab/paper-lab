import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyDraft } from '@/core/researchDesign/draft/schema';
import { examplePlan } from '@/core/researchDesign/plan/examplePlan';
import { checkPackage } from '@/core/researchDesign/plan/exportPackage';
import { emptyResearchDesign, type ResearchDesign } from '@/core/schemas/researchDesign';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import { ResearchDesignConflictError } from '@/shared/storage/researchDesigns';
import * as downloads from './download';
import PackageSection from '../sections/PackageSection';

const mock = vi.hoisted(() => ({
  complete: false,
  frozen: false,
  published: false,
  freeze: vi.fn(),
  update: vi.fn(),
  reload: vi.fn(),
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
      reload: mock.reload,
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

afterEach(() => {
  Object.assign(mock, { complete: false, frozen: false, published: false });
  mock.freeze.mockReset();
  mock.update.mockReset();
  mock.reload.mockReset();
  vi.restoreAllMocks();
});

it('PK-06 requires a nonblank change note for the next version', async () => {
  mock.complete = true;
  mock.frozen = true;
  mock.freeze.mockResolvedValue(frozenRecord());
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng băng phiên bản 2' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đóng băng' }));
  expect(screen.getByText('Cần ghi thay đổi so với phiên bản trước.')).toBeInTheDocument();
  const note = screen.getByLabelText('Thay đổi so với phiên bản trước và lý do');
  fireEvent.change(note, { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đóng băng' }));
  expect(mock.freeze).not.toHaveBeenCalled();
  fireEvent.change(note, { target: { value: '  Synthetic change  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đóng băng' }));
  await waitFor(
    () =>
      expect(mock.freeze).toHaveBeenCalledWith(
        2,
        'local',
        'Synthetic change',
        expect.anything(),
        expect.any(String),
      ),
    { timeout: 5000 },
  );
});

it('PK-07 shows a freeze conflict and reloads the stored record', async () => {
  mock.complete = true;
  mock.freeze.mockRejectedValue(new ResearchDesignConflictError('conflict'));
  mock.reload.mockResolvedValue(undefined);
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng băng phiên bản 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đóng băng' }));
  expect(
    await screen.findByText('Phiên bản vừa thay đổi. Danh sách đã được tải lại.', {}, { timeout: 5000 }),
  ).toBeInTheDocument();
  expect(mock.reload).toHaveBeenCalledOnce();
});

it('PK-05 downloads bytes and revokes the object URL', () => {
  vi.useFakeTimers();
  const create = vi.fn((_blob: Blob) => 'blob:synthetic');
  const revoke = vi.fn();
  const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    downloads.download('plan.zip', new Uint8Array([1, 2]), 'application/zip');
    expect(create.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(click).toHaveBeenCalledOnce();
    expect(click.mock.instances[0]).toHaveAttribute('download', 'plan.zip');
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:synthetic');
  } finally {
    if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate);
    else Reflect.deleteProperty(URL, 'createObjectURL');
    if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
    else Reflect.deleteProperty(URL, 'revokeObjectURL');
    vi.useRealTimers();
  }
});

it('PK-08 downloads a valid ZIP for the frozen plan', async () => {
  mock.frozen = true;
  const save = vi.spyOn(downloads, 'download').mockImplementation(() => {});
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Tải gói (.zip)' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce(), { timeout: 5000 });
  const [name, bytes, type] = save.mock.calls[0]!;
  expect(name).toMatch(/\.zip$/);
  expect(type).toBe('application/zip');
  const result = await checkPackage(bytes);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.plan).toEqual(examplePlan());
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
