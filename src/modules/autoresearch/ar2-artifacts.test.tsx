import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { at, outputs } from '@/core/autoresearch/fixtures';
import { designFixture } from '@/core/autoresearch/ar3-fixtures';
import type { Artifact } from '@/core/autoresearch/record';
import { newRun } from '@/core/autoresearch/run';
import { AuthContext } from '@/shared/auth/authContext';
import { downloadJson } from '@/shared/calibration/download';
import { ArtifactViewer } from './ArtifactViewer';
import { StageTrack } from './StageTrack';
import { DecisionInbox } from './DecisionInbox';
import { ResultsImport } from './ResultsImport';

vi.mock('@/shared/calibration/download', () => ({ downloadJson: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

function artifact(
  stage: Artifact['stage'],
  content: Artifact['content'],
  status: Artifact['status'],
): Artifact {
  const hash = `sha256:${'b'.repeat(64)}`;
  return {
    stage,
    attempt: 1,
    status,
    content,
    hash,
    charterHash: hash,
    schemaVersion: 1,
    createdAt: at,
    inputHashes: [],
    selectionHash: null,
    selectionIds: null,
    primaryId: null,
    evidence_scope: null,
    author: 'model',
    model: 'synthetic',
    promptVersion: 'synthetic',
  };
}
const run = newRun('project', 'run', 20, at);

it('AR3 shows the experiment design, frozen plan and computed results', () => {
  const records = [
    artifact('S10', { ...designFixture(), bank: null }, 'accepted'),
    artifact('S11', { planVersion: 1, frozenAt: at, etag: 'a'.repeat(64) }, 'accepted'),
    artifact(
      'S12',
      {
        resultsHash: `sha256:${'b'.repeat(64)}`,
        table: [{ dataset: 'Suite', condition: 'Control', metric: 'Agreement', n: 3, mean: 2, sd: 1 }],
        tests: [
          {
            hypothesisId: 'h-agree',
            dataset: 'Suite',
            metric: 'Agreement',
            test: 'anova_oneway',
            conditions: [],
            statistic: null,
            p: null,
            corrected: null,
            verdict: 'inconclusive',
            reason: 'unsupported_test',
          },
        ],
        hypotheses: [{ hypothesisId: 'h-agree', verdict: 'inconclusive' }],
        narrative: 'Cần xem lại Statistical analysis.',
        recommendation: 'refine',
      },
      'draft',
    ),
  ];
  const completed = { ...run, artifacts: records };
  const view = render(
    <>
      <StageTrack run={completed} stage="S12" select={vi.fn()} />
      <ArtifactViewer run={completed} stage="S10" />
      <ArtifactViewer run={completed} stage="S11" publishedAt={at} />
      <ArtifactViewer run={completed} stage="S12" />
    </>,
  );
  expect(screen.getByRole('button', { name: 'S10 · Experiment design' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'S11 · Đóng băng kế hoạch' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'S12 · Results và statistical analysis' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(view.getByText('Compare matched synthetic review tasks.')).toBeInTheDocument();
  expect(view.getByText('Phiên bản đã đóng băng')).toBeInTheDocument();
  expect(view.getByText(`Đã gửi · ${at}`)).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Thống kê mô tả theo Dataset và điều kiện' })).toBeInTheDocument();
  const tests = screen.getByRole('table', { name: 'Phép kiểm định theo kế hoạch' });
  expect(within(tests).getByText('Chưa hỗ trợ phép kiểm định')).toBeInTheDocument();
  expect(screen.getByText('Khuyến nghị · refine')).toBeInTheDocument();
});

it('AR3 pins deviations in the inbox and accepts a pasted SRD log', async () => {
  const lock = vi.fn();
  const save = vi.fn(async () => true);
  render(
    <>
      <DecisionInbox
        run={{ ...run, charter: outputs.S1.charter }}
        charter={vi.fn()}
        review={vi.fn()}
        lock={lock}
        deviation={{ runId: run.id, planVersion: 1, changedAt: at }}
      />
      <ResultsImport loaded={false} disabled={false} save={save} />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Duyệt thay đổi so với phiên bản 1' }));
  expect(lock).toHaveBeenCalledOnce();
  expect(screen.getByText('Đã ghim')).toBeInTheDocument();
  const raw = '{"runs":[{"runId":"test","condition":"Control","dataset":"Suite","metrics":{"Agreement":4}}]}';
  fireEvent.change(screen.getByLabelText('Dán results log'), { target: { value: raw } });
  fireEvent.click(screen.getByRole('button', { name: 'Nhập log' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(raw, 'json'));
  expect(await screen.findByText('Đã nhập results log.')).toBeInTheDocument();
});

it('renders S9 in the stage track and the interactive graph, exporting after approval', () => {
  const draft = artifact('S9', outputs.S9, 'draft');
  const view = render(
    <>
      <StageTrack run={run} stage="S9" select={vi.fn()} />
      <ArtifactViewer run={{ ...run, artifacts: [draft] }} stage="S9" />
    </>,
  );
  expect(screen.getByRole('button', { name: 'S9 · Argument map' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('group', { name: 'Đồ thị Argument map' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Evidence · Reported disagreement.' }), {
    key: 'Enter',
  });
  expect(
    within(screen.getByRole('region', { name: 'Argument map' })).getByText('The study reports disagreement.'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tải Argument map (JSON)' })).not.toBeInTheDocument();
  view.rerender(
    <ArtifactViewer run={{ ...run, artifacts: [{ ...draft, status: 'accepted' }] }} stage="S9" />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tải Argument map (JSON)' }));
  expect(downloadJson).toHaveBeenCalledWith(
    'argument-map-run.json',
    expect.objectContaining({
      graph: outputs.S9.graph,
      evidence_links: outputs.S9.evidence_links,
      schemaVersion: 1,
    }),
  );
});

it('offers S4 KG ingestion on demand without fetching status during render', async () => {
  const send = vi.fn(async () => Response.json({ queued: 1, processed: 0, skipped: 0, errors: [] }));
  vi.stubGlobal('fetch', send);
  const doi = '10.1000/synthetic';
  const collection = artifact(
    'S4',
    {
      candidates: outputs.S4.candidates.map((paper) => ({ ...paper, doi })),
    },
    'draft',
  );
  render(
    <AuthContext.Provider
      value={{
        user: { uid: 'test', email: 'synthetic@example.com', name: null },
        ready: true,
        error: '',
        signIn: vi.fn(),
        signOut: vi.fn(),
        getIdToken: async () => 'synthetic-token',
      }}
    >
      <ArtifactViewer run={{ ...run, artifacts: [collection] }} stage="S4" />
    </AuthContext.Provider>,
  );
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Đưa các bài này vào KG của lab' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Đã xếp 1'));
  expect(send).toHaveBeenCalledExactlyOnceWith(
    expect.stringMatching(/\/v1\/kg\/ingest$/u),
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ ids: [doi] }) }),
  );
});
