import { describe, expect, it } from 'vitest';
import { exampleCorpus } from './contract';
import { finishLabelQueue, labelCheckpoint, resumableLabelQueue, startLabelQueue } from './labelQueue';

const at = '2026-11-12T00:00:00.000Z';
const ids = ['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b'];
const start = () =>
  startLabelQueue(exampleCorpus(), {
    schemes: ['rhetoric', 'stance'],
    memberIds: ids,
    model: 'm',
    promptVersions: { rhetoric: 'r1', stance: 's1' },
    now: at,
  });

describe('C4b label queue', () => {
  it('C4b records failures per scheme and a cancel writes runs with partial counts', () => {
    const one = labelCheckpoint(start(), ids[0] ?? '', {
      rhetoric: { status: 'failed', reason: 'budget' },
      stance: { status: 'done' },
    });
    expect(one.labelQueue).toMatchObject({
      status: 'running',
      pending: [ids[1]],
      counts: { rhetoric: { done: 0, failed: 1, skipped: 0 }, stance: { done: 1, failed: 0, skipped: 0 } },
      failed: [{ memberId: ids[0], scheme: 'rhetoric', reason: 'budget' }],
    });
    expect(resumableLabelQueue(finishLabelQueue(one, 'paused', at).labelQueue)).toBe(true);
    const cancelled = finishLabelQueue(one, 'cancelled', at);
    expect(resumableLabelQueue(cancelled.labelQueue)).toBe(false);
    expect(cancelled.runs.slice(-2)).toEqual([
      { scheme: 'rhetoric', model: 'm', promptVersion: 'r1', done: 0, failed: 1, skipped: 0, createdAt: at },
      { scheme: 'stance', model: 'm', promptVersion: 's1', done: 1, failed: 0, skipped: 0, createdAt: at },
    ]);
  });

  it('C4b refuses a checkpoint for a member that is not next', () => {
    expect(() => labelCheckpoint(start(), ids[1] ?? '', {})).toThrow('Invalid label checkpoint');
  });
});
