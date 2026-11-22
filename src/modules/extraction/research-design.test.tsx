import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { newProject } from '@/core/extraction';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import type { LlmClient } from '@/shared/llm/client';
import { revokeConsent } from '@/shared/llm/consent';
import { StorageProvider, StorageStatus } from '@/shared/storage/StorageProvider';
import { AuthContext } from '@/shared/auth/authContext';
import { testId, testWorkerData } from '@/shared/storage/remoteTestSupport';
import ExtractionPage from './Page';
import ProjectPage from './ProjectPage';
import { currentArtifact, selectable } from '@/core/autoresearch/artifacts';
import { STAGES } from '@/core/autoresearch/contracts';
import { at, charter, outputs } from '@/core/autoresearch/fixtures';
import { approveCharter, beginStage, decideGate, openGate, putArtifact } from '@/core/autoresearch/run';
import { testRepositories } from '@/shared/storage/testRepositories';

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

const testAuth = {
  user: { uid: 'test', email: 'test@hyperdatalab.org', name: null },
  ready: true,
  error: '',
  signIn: async () => {},
  signOut: async () => {},
  getIdToken: async () => 'lab-test',
};

it('creates an extraction project and edits its research design through the signed-in worker store', async () => {
  const worker = testWorkerData();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', worker.dispatch);
  try {
    render(
      <AuthContext.Provider value={testAuth}>
        <MemoryRouter initialEntries={['/extraction?design=topic']}>
          <StorageProvider projectId={testId(1)}>
            <StorageStatus />
            <LlmProvider innerClient={{ completeJson: vi.fn() }}>
              <Routes>
                <Route path="/extraction" element={<ExtractionPage />} />
                <Route path="/extraction/:id" element={<ProjectPage />} />
              </Routes>
            </LlmProvider>
          </StorageProvider>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    await screen.findByText('Chưa có project nào.');
    fireEvent.click(screen.getByRole('button', { name: 'Project mới' }));
    fireEvent.change(screen.getByLabelText('Tên project'), { target: { value: 'Shared extraction' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo project' }));
    await screen.findByRole('heading', { name: 'Shared extraction' });
    fireEvent.click(await screen.findByRole('button', { name: 'Topic và research gaps' }));
    const statement = await screen.findByRole('textbox', { name: 'Phát biểu đề tài' });
    fireEvent.change(statement, { target: { value: 'A topic stored by the lab.' } });
    fireEvent.blur(statement);
    const remote = worker.connect();
    const [row] = await remote.query('extractionProjects', { select: 'summary' });
    if (!row) throw new Error('Project missing from the worker');
    await waitFor(async () => {
      expect((await remote.get('researchDesigns', row.id))?.doc).toMatchObject({
        topicCheck: { statement: 'A topic stored by the lab.' },
      });
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

it('shows an error, not a browser fallback, when the signed-in worker has no data binding', async () => {
  const worker = testWorkerData(false);
  vi.stubGlobal('fetch', worker.dispatch);
  try {
    render(
      <AuthContext.Provider value={testAuth}>
        <MemoryRouter>
          <StorageProvider projectId={testId(1)}>
            <StorageStatus />
            <ExtractionPage />
          </StorageProvider>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(await screen.findByText(/Kho dữ liệu project chưa được cấu hình/)).toBeInTheDocument();
    expect(screen.queryByText(/thiết bị này/)).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

async function mountProject(
  paperId: string | null,
  search = '',
  seed?: (repo: ReturnType<typeof testRepositories>, projectId: string) => Promise<void>,
  innerClient: LlmClient = { completeJson: vi.fn() },
) {
  vi.stubGlobal('crypto', webcrypto);
  const repo = testRepositories();
  const project = await repo.extraction.save({
    ...newProject({
      id: crypto.randomUUID(),
      title: 'Project thử',
      researchQuestion: '',
      now: '2026-01-01T00:00:00.000Z',
    }),
    paperId,
  });
  await seed?.(repo, project.id);
  render(
    <MemoryRouter initialEntries={[`/extraction/${project.id}${search}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={innerClient}>
          <Location />
          <Routes>
            <Route path="/extraction/:id" element={<ProjectPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'Project thử' });
  // The heading can appear while Vite is still loading the route's lazy panel.
  await act(() => vi.dynamicImportSettled());
  return { repo, projectId: project.id };
}

it('groups Research Design sections and keeps AutoResearch available as a project tab', async () => {
  await mountProject(null, '?other=kept');
  const tablist = screen.getByRole('tablist', { name: 'Không gian project' });
  expect(
    within(tablist)
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual(['Research Design', 'AutoResearch']);
  expect(screen.queryByRole('heading', { name: 'Kế hoạch tìm kiếm' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Định hình nghiên cứu' })).toBeInTheDocument();
  expect(
    await screen.findByRole('button', { name: 'Thêm bài gần nhất' }, { timeout: 5000 }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Writing Bank' }));
  await act(() => vi.dynamicImportSettled());
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?other=kept&design=bank'));
  expect(
    await within(screen.getByRole('tabpanel')).findByRole(
      'button',
      { name: 'Nhập bản chụp' },
      { timeout: 5000 },
    ),
  ).toBeInTheDocument();
});

it('opens a section from a deep link', async () => {
  await mountProject(null, '?design=evidence');
  expect(screen.getByRole('button', { name: 'Bảng so sánh' })).toHaveAttribute('aria-current', 'page');
  expect(
    await within(screen.getByRole('tabpanel')).findByText('Chưa có bài báo nào được chọn', undefined, {
      timeout: 5000,
    }),
  ).toBeInTheDocument();
});

it('keeps grouped section choices available in the compact picker', async () => {
  await mountProject(null, '?design=topic');
  fireEvent.click(screen.getByRole('combobox', { name: 'Mục nghiên cứu' }));
  fireEvent.click(screen.getByRole('option', { name: 'Phương pháp · Measurement' }));
  expect(await screen.findByRole('heading', { name: 'Measurement' })).toBeInTheDocument();
});

it('keeps both project workspaces available when the project is linked to a paper', async () => {
  await mountProject('00000000-0000-4000-8000-000000000001');
  expect(screen.getByRole('tablist', { name: 'Không gian project' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Định hình nghiên cứu' })).toBeInTheDocument();
});

it('AR1 opens a stage deep link and copies selected hypotheses into Research design as candidates', async () => {
  const { repo, projectId } = await mountProject(null, '?ar=S8', async (repo, projectId) => {
    const models = {
      lead: 'lead',
      critic: 'critic',
      sharedModel: false,
      stagePrompt: 'test',
      criticPrompt: 'test',
      piPrompt: 'test',
    };
    let run = await repo.autoresearch.create(projectId, 100);
    run = await approveCharter(run, charter, at, null);
    for (const stage of STAGES.slice(0, STAGES.indexOf('S8') + 1)) {
      if (stage === 'S10' || stage === 'S11' || stage === 'S12') throw new Error('Unexpected stage');
      run = await beginStage(run, stage, models, at);
      run = openGate(await putArtifact(run, stage, outputs[stage], at), stage, at);
      const ids = selectable(currentArtifact(run, stage)).map((item) => item.id);
      run = await decideGate(
        run,
        stage,
        {
          approve: true,
          ids: stage === 'S8' ? ['h-agree'] : ids,
          primaryId: stage === 'S8' ? 'h-agree' : null,
          note: null,
        },
        at,
      );
    }
    await repo.autoresearch.save(run);
  });
  expect(await screen.findByRole('heading', { name: 'S8 · Hypotheses' })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Chép hypotheses vào Research design' }));
  const link = await screen.findByRole('link', { name: 'Mở Research questions và hypotheses' });
  expect((await repo.researchDesigns.get(projectId))?.draft.hypotheses).toMatchObject([
    {
      statement: 'Calibration increases agreement between reviewers.',
      autoresearch: { status: 'candidate', primary: true },
    },
  ]);
  fireEvent.click(link);
  await act(() => vi.dynamicImportSettled());
  expect(await screen.findByText('Ứng viên từ AutoResearch')).toBeInTheDocument();
  expect(screen.queryByText(/Randomizing item order reduces/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận hypothesis' }));
  await waitFor(() => expect(screen.queryByText('Ứng viên từ AutoResearch')).not.toBeInTheDocument());
  expect((await repo.researchDesigns.get(projectId))?.draft.hypotheses[0]?.autoresearch?.status).toBe(
    'accepted',
  );
});

it('AR1 shows the estimate and asks for consent before spending a call, then cancels an active run', async () => {
  revokeConsent();
  const ask = vi.fn();
  const { repo, projectId } = await mountProject(
    null,
    '?ar=S1',
    async (repo, projectId) => {
      const run = await repo.autoresearch.create(projectId, 20);
      await repo.autoresearch.save(await approveCharter(run, charter, at, null));
    },
    {
      async completeJson(options) {
        await options.onRequest?.();
        ask(options.schemaName);
        return new Promise<never>((_resolve, reject) => {
          if (options.signal?.aborted) reject(options.signal.reason);
          else
            options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
        });
      },
    },
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Chạy stage' }));
  expect(screen.getByText(/Dự kiến 3 lượt gọi AI/)).toBeInTheDocument();
  expect(ask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }));
  expect(await screen.findByText(/Charter, chỉ dẫn, nội dung bài báo/)).toBeInTheDocument();
  expect(ask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }));
  await waitFor(() => expect(ask).toHaveBeenCalledWith('autoresearch_s1'));
  fireEvent.click(screen.getByRole('button', { name: 'Dừng' }));
  await waitFor(async () =>
    expect((await repo.autoresearch.list(projectId))[0]).toMatchObject({
      status: 'ended',
      endReason: 'cancelled',
      budget: { calls: 1 },
    }),
  );
  expect(await screen.findByText('Đã huỷ')).toBeInTheDocument();
  revokeConsent();
});
