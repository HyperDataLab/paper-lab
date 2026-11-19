import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { at, outputs } from '@/core/autoresearch/fixtures';
import type { Artifact } from '@/core/autoresearch/record';
import { newRun } from '@/core/autoresearch/run';
import { AuthContext } from '@/shared/auth/authContext';
import { downloadJson } from '@/shared/calibration/download';
import { ArtifactViewer } from './ArtifactViewer';
import { StageTrack } from './StageTrack';

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
