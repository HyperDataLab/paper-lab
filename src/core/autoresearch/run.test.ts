import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { acceptedInputs, canResume, currentArtifact } from './artifacts';
import { STAGES } from './contracts';
import { editArtifact } from './edit';
import { at, charter, critic, outputs, seriousPoint } from './fixtures';
import { runSchema, type Run } from './record';
import {
  approveCharter,
  beginStage,
  checkObligation,
  decideGate,
  endRun,
  newRun,
  nextStage,
  openGate,
  patchStage,
  putArtifact,
} from './run';

const models = {
  lead: 'synthetic-lead',
  critic: 'synthetic-critic',
  sharedModel: false,
  stagePrompt: 'test',
  criticPrompt: 'test',
  piPrompt: 'test',
};
const approve = { approve: true, ids: [], primaryId: null, note: null };
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

async function through(count: number, risk = false) {
  let run: Run = await approveCharter(newRun('project', 'run', 200, at), charter, at, null);
  for (const stage of STAGES.slice(0, count)) {
    run = await beginStage(run, stage, models, at);
    expect(run.status).toBe('running');
    run = await putArtifact(run, stage, outputs[stage], at);
    if (risk && stage === 'S1')
      run = patchStage(run, stage, { critic: { ...critic, points: [seriousPoint], verdict: 'serious' } });
    run = openGate(run, stage, at);
    expect(run.status).toBe('waiting');
    const ids =
      stage === 'S5'
        ? ['screen:title:fictional study']
        : stage === 'S6'
          ? ['card-a']
          : stage === 'S7'
            ? ['g-agree', 'g-repeat']
            : stage === 'S8'
              ? ['h-agree']
              : [];
    run = await decideGate(run, stage, { ...approve, ids, primaryId: stage === 'S8' ? 'h-agree' : null }, at);
  }
  return run;
}

it('AR1 run machine requires a pinned charter, ordered stages and human approval', async () => {
  const run = newRun('project', 'run', 20, at);
  expect(runSchema.parse(run)).toEqual(run);
  await expect(beginStage(run, 'S1', models, at)).rejects.toThrow('charter');
  const registered = await approveCharter(run, charter, at, null);
  await expect(beginStage(registered, 'S2', models, at)).rejects.toThrow('Earlier');
  const running = await beginStage(registered, 'S1', models, at);
  await expect(decideGate(running, 'S1', approve, at)).rejects.toThrow('Gate is closed');
  const gate = openGate(await putArtifact(running, 'S1', outputs.S1, at), 'S1', at);
  await expect(beginStage(gate, 'S1', models, at)).rejects.toThrow('Human decision');
  await expect(decideGate(gate, 'S1', { ...approve, approve: false }, at)).rejects.toThrow('note');
  const rejected = await decideGate(
    gate,
    'S1',
    { ...approve, approve: false, note: 'Narrow the scope.' },
    at,
  );
  expect(nextStage(rejected)?.state).toBe('rejected');
  expect(rejected.artifacts[0]?.status).toBe('stale');
  expect(endRun(rejected, 'failed', at)).toMatchObject({ status: 'ended', endReason: 'failed', endedAt: at });
  expect(endRun(running, 'cancelled', at).pipeline[0]?.state).toBe('rejected');
  expect(() => endRun(running, 'complete', at)).toThrow('approval');
});

it('invalidates the edited stage and every later artifact, and requires human escalation for charter amendments', async () => {
  const run = await through(3);
  const rerun = await beginStage(run, 'S2', models, at);
  expect(rerun.artifacts.map((a) => a.status)).toEqual(['accepted', 'stale', 'stale']);
  expect(rerun.pipeline.slice(0, 4).map((a) => a.state)).toEqual(['accepted', 'working', 'stale', 'idle']);
  expect(await canResume(rerun)).toBe(true);
  const amended = { ...charter, constraints: ['Use text only.'] };
  await expect(approveCharter(run, amended, at, null)).rejects.toThrow('escalation');
  const escalated = await approveCharter(run, amended, at, 'Change before collecting data');
  expect(escalated.artifacts.every((a) => a.status === 'stale')).toBe(true);
  expect(escalated.decisions.at(-1)?.action).toBe('escalate');
});

it('keeps a human edit alongside the previous artifact and requires review before continuing', async () => {
  const run = await through(3);
  const changed = { ...outputs.S2, rationale: 'The simulation uses judged synthetic examples.' };
  const edited = await editArtifact(run, 'S2', changed, models, at, 'Clarify the source of examples.');
  expect(edited.status).toBe('waiting');
  expect(edited.pipeline[1]?.state).toBe('working');
  expect(edited.artifacts.map((a) => a.status)).toEqual(['accepted', 'stale', 'stale', 'draft']);
  expect(edited.artifacts.at(-1)).toMatchObject({
    stage: 'S2',
    author: 'person',
    model: null,
    content: changed,
  });
  expect(edited.decisions.at(-1)?.action).toBe('edit');
  expect(await canResume(edited)).toBe(true);
  await expect(beginStage(edited, 'S3', models, at)).rejects.toThrow('Earlier');
  await expect(
    editArtifact(
      run,
      'S1',
      { ...outputs.S1, charter: { ...charter, question: 'Different?' } },
      models,
      at,
      'Amend charter.',
    ),
  ).rejects.toThrow('pinned approval');
});

it('blocks resume when charter, content, selection or predecessor digest is different', async () => {
  const run = await through(3);
  expect(await canResume(run)).toBe(true);
  expect(await canResume({ ...run, charter: { ...charter, question: 'Different?' } })).toBe(false);
  for (const change of [
    { content: { ...outputs.S2, rationale: 'Edited.' } },
    { selectionIds: ['q-control'] },
    { inputHashes: [] },
  ]) {
    const changed = {
      ...run,
      artifacts: run.artifacts.map((a) => (a.stage === 'S2' ? { ...a, ...change } : a)),
    };
    expect(await canResume(changed)).toBe(false);
    await expect(beginStage(changed, 'S4', models, at)).rejects.toThrow('hashes');
  }
  const working = await beginStage(run, 'S4', models, at);
  expect(await canResume(working)).toBe(true);
  expect(await canResume(patchStage(working, 'S4', { cardCursor: 11 }))).toBe(false);
});

it('carries accepted Critic risks forward and lists unresolved obligations on completion', async () => {
  const run = await through(2, true);
  const id = run.obligations[0]?.id ?? '';
  expect(run.obligations[0]).toMatchObject({ sourceStage: 'S1', targetStage: 'S2', status: 'open' });
  expect(() => checkObligation(run, id, 'controlled', 'S1', 'Allocation reported.')).toThrow();
  const controlled = checkObligation(run, id, 'controlled', 'S2', 'Allocation reported.');
  expect(controlled.obligations[0]).toMatchObject({
    status: 'controlled',
    locator: currentArtifact(run, 'S2')?.hash,
  });
  expect((await beginStage(controlled, 'S2', models, at)).obligations[0]?.status).toBe('open');
  const ended = await through(8, true);
  expect(ended).toMatchObject({
    status: 'ended',
    endReason: 'with_gaps',
    obligations: [{ status: 'unresolved' }],
  });
  expect(acceptedInputs(ended, 'S8').S7?.gaps).toHaveLength(2);
  expect((await through(8)).endReason).toBe('complete');
});
