import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { newProject } from '@/core/extraction';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import type { LlmClient } from '@/shared/llm/client';
import { revokeConsent } from '@/shared/llm/consent';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import ProjectPage from './ProjectPage';
import { currentArtifact, selectable } from '@/core/autoresearch/artifacts';
import { STAGES } from '@/core/autoresearch/contracts';
import { at, charter, outputs } from '@/core/autoresearch/fixtures';
import { approveCharter, beginStage, decideGate, openGate, putArtifact } from '@/core/autoresearch/run';

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

async function mountProject(
  paperId: string | null,
  search = '',
  seed?: (repo: ReturnType<typeof createRepositories>, projectId: string) => Promise<void>,
  innerClient: LlmClient = { completeJson: vi.fn() },
) {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`design-shell-${crypto.randomUUID()}`));
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

it('shows the ordered sections on a multi-paper project and changes the linked section', async () => {
  await mountProject(null, '?other=kept');
  const tablist = screen.getByRole('tablist', { name: 'Research design' });
  const deepResearchHeading = screen.getByRole('heading', { name: 'Kế hoạch tìm kiếm' });
  expect(
    tablist.compareDocumentPosition(deepResearchHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const tabs = within(tablist).getAllByRole('tab');
  expect(tabs.map((tab) => tab.textContent)).toEqual([
    'Topic và research gaps',
    'Research questions và hypotheses',
    'Research design',
    'Measurement',
    'Writing Bank',
    'Statistical analysis',
    'Ma trận chạy',
    'Bảng so sánh',
    'Gói kế hoạch',
  ]);
  expect(
    await screen.findByRole('button', { name: 'Thêm bài gần nhất' }, { timeout: 5000 }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Writing Bank' }));
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
  expect(screen.getByRole('tab', { name: 'Bảng so sánh' })).toHaveAttribute('aria-selected', 'true');
  expect(
    await within(screen.getByRole('tabpanel')).findByText('Chưa có bài báo nào được chọn', undefined, {
      timeout: 5000,
    }),
  ).toBeInTheDocument();
});

it('does not show the area on a paper-owned project', async () => {
  await mountProject('00000000-0000-4000-8000-000000000001');
  expect(screen.queryByRole('tablist', { name: 'Research design' })).not.toBeInTheDocument();
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
    for (const stage of STAGES) {
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
