import { fireEvent, render, screen, within } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { currentArtifact } from '@/core/autoresearch/artifacts';
import { at, charter, critic, outputs, pi, seriousPoint } from '@/core/autoresearch/fixtures';
import { newRun, patchStage, putArtifact, stageState } from '@/core/autoresearch/run';
import { StageTrack } from './StageTrack';
import { DecisionInbox } from './DecisionInbox';
import { GateSheet } from './GateSheet';
import { PiPanel } from './PiPanel';
import { CriticPanel } from './CriticPanel';
import { ArtifactFields } from './ArtifactFields';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

it('shows stage states and pinned decisions, and navigates to the chosen stage', () => {
  let run = newRun('project', 'run', 50, at);
  run = patchStage(run, 'S8', { state: 'gate' });
  run = patchStage(run, 'S3', { state: 'stale' });
  const select = vi.fn();
  const edit = vi.fn();
  const review = vi.fn();
  render(
    <>
      <StageTrack run={run} stage="S8" select={select} />
      <DecisionInbox run={run} charter={edit} review={review} />
    </>,
  );
  expect(screen.getByText('Đã cũ')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'S8 · Hypotheses' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByText('Đã ghim')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'S3 · Chiến lược tìm kiếm' }));
  fireEvent.click(screen.getByRole('button', { name: 'Duyệt charter' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chọn hypotheses và primary hypothesis' }));
  expect(select).toHaveBeenCalledWith('S3');
  expect(edit).toHaveBeenCalledOnce();
  expect(review).toHaveBeenCalledWith('S8');
});

it('requires an explicit primary hypothesis and supports dropping an item from a human selection', async () => {
  const run = patchStage(
    {
      ...newRun('project', 'run', 50, at),
      status: 'running',
      charter,
      charterHash: `sha256:${'b'.repeat(64)}`,
    },
    'S8',
    { state: 'working', attempt: 1 },
  );
  const checkpoint = await putArtifact(run, 'S8', outputs.S8, at);
  const decide = vi.fn();
  render(
    <GateSheet
      state={stageState(checkpoint, 'S8')}
      artifact={currentArtifact(checkpoint, 'S8')}
      busy={false}
      close={vi.fn()}
      decide={decide}
    />,
  );
  const sheet = within(screen.getByRole('dialog'));
  const approval = sheet.getByRole('button', { name: 'Duyệt' });
  expect(approval).toBeDisabled();
  const kept = sheet.getByRole('checkbox', { name: 'Calibration increases agreement between reviewers.' });
  const dropped = sheet.getByRole('checkbox', {
    name: 'Randomizing item order reduces within-reviewer variation.',
  });
  fireEvent.click(kept);
  fireEvent.click(dropped);
  fireEvent.click(dropped);
  fireEvent.click(sheet.getByRole('combobox', { name: 'Primary hypothesis' }));
  fireEvent.click(sheet.getByRole('option', { name: 'Calibration increases agreement between reviewers.' }));
  fireEvent.click(approval);
  expect(decide).toHaveBeenCalledWith({ approve: true, ids: ['h-agree'], primaryId: 'h-agree', note: null });
  const reject = sheet.getByRole('button', { name: 'Từ chối' });
  expect(reject).toBeDisabled();
  fireEvent.change(sheet.getByRole('textbox'), { target: { value: 'Collect more evidence.' } });
  fireEvent.click(reject);
  expect(decide).toHaveBeenLastCalledWith(
    expect.objectContaining({ approve: false, note: 'Collect more evidence.' }),
  );
});

it('renders PI advice and Critic findings with obligations and keeps missing numbers unknown', () => {
  render(
    <>
      <PiPanel decision={pi} />
      <CriticPanel
        report={{ ...critic, points: [seriousPoint], verdict: 'serious' }}
        stage="S2"
        obligations={[
          {
            id: 'risk-a',
            sourceStage: 'S1',
            targetStage: 'S2',
            itemId: null,
            findingId: 'point-a',
            text: 'Check allocation',
            status: 'open',
            locator: null,
            note: null,
          },
        ]}
      />
      <ArtifactFields value={{ thresholds: { quality: null, relevance: 0.5 } }} />
    </>,
  );
  expect(screen.getByRole('heading', { name: 'Đề xuất của PI' })).toBeInTheDocument();
  expect(screen.getByText(pi.rationale)).toBeInTheDocument();
  expect(screen.getByText('Preserve uncertainty.')).toBeInTheDocument();
  expect(screen.getByText('Có vấn đề nghiêm trọng')).toBeInTheDocument();
  expect(screen.getByText(seriousPoint.text)).toBeInTheDocument();
  expect(screen.getByText('Check allocation · Đang mở')).toBeInTheDocument();
  expect(screen.getByText('Chưa xác định')).toBeInTheDocument();
  expect(screen.getByText('0,5')).toBeInTheDocument();
});
