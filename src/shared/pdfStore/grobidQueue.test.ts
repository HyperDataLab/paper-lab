import { describe, expect, it, vi } from 'vitest';
import type { Paper } from '@/core/schemas';
import type { Repositories } from '@/shared/storage/types';
import { createGrobidQueue, type GrobidQueueStatus } from './grobidQueue';
import { requestGrobid } from './grobidSync';

vi.mock('./grobidSync', () => ({ requestGrobid: vi.fn() }));
const sha = 'a'.repeat(64);
const paper = (id: string) => ({ id, source: { kind: 'pdf', sha256: `sha256:${sha}` } }) as Paper;
const ready = { status: 'ready', result: {}, error: null, sha256: sha };

function setup(signedIn = true, get = vi.fn().mockResolvedValue(undefined)) {
  const repo = { grobid: { get } } as unknown as Repositories;
  const statuses: Record<string, GrobidQueueStatus> = {};
  const queue = createGrobidQueue(
    repo,
    () => ({ signedIn, getIdToken: async () => 'token' }),
    (id, value) => {
      statuses[id] = value;
    },
  );
  return { queue, statuses };
}

describe('GROBID import queue', () => {
  it('runs at most two requests and continues after a failure', async () => {
    vi.mocked(requestGrobid).mockReset();
    let active = 0;
    let maximum = 0;
    const releases: (() => void)[] = [];
    vi.mocked(requestGrobid).mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      if (releases.length === 2) throw new Error('worker failed');
      return ready as never;
    });
    const { queue, statuses } = setup();
    ['1', '2', '3'].forEach((id) => queue.enqueue(id, paper(id)));
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[0]?.();
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases[1]?.();
    releases[2]?.();
    await vi.waitFor(() => expect(statuses['3']?.status).toBe('ready'));
    expect(statuses['1']).toEqual({ status: 'failed', reason: 'worker failed' });
    expect(maximum).toBe(2);
  });

  it('skips an already-ready record for the same sha', async () => {
    vi.mocked(requestGrobid).mockReset();
    const { queue, statuses } = setup(true, vi.fn().mockResolvedValue(ready));
    queue.enqueue('1', paper('1'));
    await vi.waitFor(() => expect(statuses['1']?.status).toBe('ready'));
    expect(requestGrobid).not.toHaveBeenCalled();
  });

  it('waits for sign-in without requesting the worker', async () => {
    vi.mocked(requestGrobid).mockReset();
    const { queue, statuses } = setup(false);
    queue.enqueue('1', paper('1'));
    await vi.waitFor(() => expect(statuses['1']?.status).toBe('waiting'));
    expect(requestGrobid).not.toHaveBeenCalled();
  });
});
