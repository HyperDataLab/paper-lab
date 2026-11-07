import { describe, expect, it, vi } from 'vitest';
import type { Paper, PaperRun } from '../schemas';
import { planRun } from './planRun';
import { runBatch, type BatchDeps, type BatchSignal } from './runBatch';

const at = '2026-01-01T00:00:00.000Z';
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: '',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
  sections: [{ id: 's', heading: 'Methods', role: 'methods', level: 1, pageStart: null }],
  paragraphs: ['First.', 'Second.', 'Third.'].map((text, order) => ({
    id: `p${order}`,
    sectionId: 's',
    order,
    text,
    pageStart: null,
    kind: 'body',
    textHash: `h${order}`,
  })),
};
function setup(budget = 20) {
  const plan = planRun(paper, { sectionIds: ['s'], steps: ['judge', 'score'], budget });
  const run: PaperRun = {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000002',
    paperId: paper.id,
    createdAt: at,
    updatedAt: at,
    status: 'idle',
    plan,
    budget,
    callsUsed: 0,
    promptVersions: {},
    model: 'm',
    items: plan.paragraphs.map((p) => ({
      paragraphId: p.paragraphId,
      textHash: p.textHash,
      analysisId: null,
      status: 'pending',
      stepsDone: [],
      calls: 0,
      error: null,
    })),
  };
  const analyze = vi.fn<BatchDeps['analyze']>(async () => '00000000-0000-4000-8000-000000000003');
  const save = vi.fn<BatchDeps['save']>(async () => {});
  const sleep = vi.fn<BatchDeps['sleep']>(async () => {});
  return { run, analyze, save, sleep, deps: { paper, analyze, save, sleep, now: () => at } };
}
describe('P2 runBatch', () => {
  it('checkpoints every step and paragraph and supplies neighbouring sentences', async () => {
    const t = setup();
    const result = await runBatch(t.run, t.deps);
    expect(result.status).toBe('done');
    expect(result.callsUsed).toBe(6);
    expect(t.save.mock.calls.some(([run]) => run.items[0]?.stepsDone.length === 1)).toBe(true);
    expect(t.save.mock.calls.some(([run]) => run.items[0]?.status === 'done')).toBe(true);
    expect(t.analyze.mock.calls.find(([p]) => p.id === 'p1')?.[1]).toMatchObject({
      previousLast: 'First.',
      nextFirst: 'Third.',
    });
  });
  it('retries transient failures with exponential backoff', async () => {
    const t = setup();
    let attempts = 0;
    t.analyze.mockImplementation(async (_p, _c, step) => {
      if (step === 'judge' && attempts++ < 2) throw { status: attempts === 1 ? 429 : 503 };
      return '00000000-0000-4000-8000-000000000003';
    });
    const result = await runBatch(t.run, t.deps);
    expect(t.sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
    expect(result.callsUsed).toBe(8);
  });
  it('does not retry 4xx and continues after a failed item', async () => {
    const t = setup();
    t.analyze.mockImplementation(async (p, _c, step) => {
      if (p.id === 'p0' && step === 'judge') throw { status: 400 };
      return '00000000-0000-4000-8000-000000000003';
    });
    const result = await runBatch(t.run, t.deps);
    expect(result.items.map((item) => item.status)).toEqual(['failed', 'done', 'done']);
    expect(t.sleep).not.toHaveBeenCalled();
  });
  it('stops at the budget with later items pending', async () => {
    const t = setup(1);
    const result = await runBatch(t.run, t.deps);
    expect(result.status).toBe('budget_exceeded');
    expect(result.callsUsed).toBe(1);
    expect(result.items.map((item) => item.status)).toEqual(['pending', 'pending', 'pending']);
  });
  it('pauses and resumes at the first missing step', async () => {
    const t = setup();
    const signal: BatchSignal = {};
    t.analyze.mockImplementation(async (_p, _c, step) => {
      if (step === 'judge') signal.action = 'pause';
      return '00000000-0000-4000-8000-000000000003';
    });
    const paused = await runBatch(t.run, t.deps, signal);
    expect(paused.status).toBe('paused');
    expect(paused.items[0]?.stepsDone).toEqual(['judge']);
    delete signal.action;
    t.analyze.mockResolvedValue('00000000-0000-4000-8000-000000000003');
    const result = await runBatch(paused, t.deps, signal);
    expect(result.status).toBe('done');
    expect(t.analyze.mock.calls.filter(([p, , step]) => p.id === 'p0' && step === 'judge')).toHaveLength(1);
  });
  it('cancels before beginning a paragraph', async () => {
    const t = setup();
    expect((await runBatch(t.run, t.deps, { action: 'cancel' })).status).toBe('cancelled');
    expect(t.analyze).not.toHaveBeenCalled();
  });
  it('uses cached analyses without calls', async () => {
    const t = setup();
    const result = await runBatch(t.run, {
      ...t.deps,
      findCached: async () => '00000000-0000-4000-8000-000000000003',
    });
    expect(result.items.every((item) => item.status === 'cached')).toBe(true);
    expect(t.analyze).not.toHaveBeenCalled();
  });
});
