import { describe, expect, it, vi } from 'vitest';
import type { Paper, PaperRun, TransitionPair } from '../schemas';
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
  const analyze = vi.fn<BatchDeps['analyze']>(async (_p, _c, step, _id, onRequest) => {
    if (step !== 'detectors') await onRequest?.();
    return '00000000-0000-4000-8000-000000000003';
  });
  const save = vi.fn<BatchDeps['save']>(async () => {});
  const sleep = vi.fn<BatchDeps['sleep']>(async () => {});
  return { run, analyze, save, sleep, deps: { paper, analyze, save, sleep, now: () => at } };
}
describe('P2 runBatch', () => {
  it('P7 records a snapshot per executed step and actual calls including retries', async () => {
    const t = setup();
    t.run.callsByStep = {};
    t.run.calibrationSnapshots = {};
    const captureCalibration = vi.fn(async () => [
      { kind: 'issue' as const, type: 'FUZZY_VERB', n: 30, status: 'reliable' as const },
    ]);
    const recordCalibration = vi.fn(async () => {});
    const result = await runBatch(t.run, { ...t.deps, captureCalibration, recordCalibration });
    expect(result.callsByStep).toEqual({ judge: 3, score: 3 });
    expect(result.calibrationSnapshots?.judge?.[0]).toMatchObject({ status: 'reliable', n: 30 });
    expect(captureCalibration).toHaveBeenCalledTimes(3);
    expect(recordCalibration).toHaveBeenCalledTimes(9);
  });
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
    t.analyze.mockImplementation(async (_p, _c, step, _id, onRequest) => {
      if (step !== 'detectors') await onRequest?.();
      if (step === 'judge' && attempts++ < 2) throw { status: attempts === 1 ? 429 : 503 };
      return '00000000-0000-4000-8000-000000000003';
    });
    const result = await runBatch(t.run, t.deps);
    expect(t.sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
    expect(result.callsUsed).toBe(8);
  });
  it('counts a repaired response as an extra call', async () => {
    const t = setup();
    t.analyze.mockImplementation(async (_p, _c, step, _id, onRequest) => {
      if (step !== 'detectors') await onRequest?.();
      if (step === 'judge') await onRequest?.();
      return '00000000-0000-4000-8000-000000000003';
    });
    const result = await runBatch(t.run, t.deps);
    expect(result.callsUsed).toBe(9);
    expect(result.items.map((item) => item.calls)).toEqual([3, 3, 3]);
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
  it('P3 estimates and executes section transition chunks within the budget', async () => {
    const t = setup(1);
    t.run.plan = planRun(paper, { sectionIds: ['s'], steps: ['transitions'], budget: 1 });
    expect(t.run.plan.calls.transitions).toBe(1);
    const pairs = [
      {
        pairId: 'p0->p1',
        sectionId: 's',
        sectionRole: 'methods',
        from: {
          paragraphId: 'p0',
          analysisId: '00000000-0000-4000-8000-000000000003',
          span: { start: 0, end: 1 },
          quote: 'F',
          sentence: 'First.',
        },
        to: {
          paragraphId: 'p1',
          analysisId: '00000000-0000-4000-8000-000000000004',
          span: { start: 0, end: 1 },
          quote: 'S',
          sentence: 'Second.',
        },
      },
    ];
    const analyzeTransitions = vi.fn(async (_pairs: TransitionPair[], onRequest: () => Promise<void>) =>
      onRequest(),
    );
    const result = await runBatch(t.run, {
      ...t.deps,
      getTransitionPairs: async () => pairs,
      analyzeTransitions,
    });
    expect(result.status).toBe('done');
    expect(result.callsUsed).toBe(1);
    expect(result.transitionDone).toEqual(['p0->p1']);
    expect(result.plan.skipped).toContainEqual({
      paragraphId: 'p1->p2',
      reason: 'missing syntax annotations',
    });
    const limited = await runBatch(
      { ...t.run, budget: 0 },
      { ...t.deps, getTransitionPairs: async () => pairs, analyzeTransitions },
    );
    expect(limited.status).toBe('budget_exceeded');
    expect(limited.callsUsed).toBe(0);
  });
  it('P2 uses neighbouring body paragraphs across section boundaries', async () => {
    const t = setup();
    const first = paper.paragraphs[0];
    if (!first) throw new Error('missing paragraph');
    const across: Paper = {
      ...paper,
      sections: [
        ...paper.sections,
        { id: 'next', heading: 'Results', role: 'results', level: 1, pageStart: null },
      ],
      paragraphs: [
        ...paper.paragraphs,
        { ...first, id: 'caption', sectionId: 'next', kind: 'caption', order: 0 },
        { ...first, id: 'nextbody', text: 'Next section.', sectionId: 'next', order: 1 },
      ],
    };
    await runBatch(t.run, { ...t.deps, paper: across });
    expect(t.analyze.mock.calls.find(([p]) => p.id === 'p2')?.[1].nextFirst).toBe('Next section.');
  });
});

describe('P2 shared syntax requests', () => {
  function syntaxSetup(budget = 20) {
    const t = setup(budget);
    t.run.plan = planRun(paper, { sectionIds: ['s'], steps: ['syntax'], budget });
    t.analyze.mockImplementation(async (paragraph) => `analysis-${paragraph.id}`);
    const analyzeSyntaxBatch = vi.fn<NonNullable<BatchDeps['analyzeSyntaxBatch']>>(
      async (members, onRequest) => {
        await onRequest();
        return members.map((member) => member.paragraph.id);
      },
    );
    return { ...t, analyzeSyntaxBatch, deps: { ...t.deps, analyzeSyntaxBatch } };
  }
  const failOnce = (t: ReturnType<typeof syntaxSetup>, message: string) =>
    t.analyzeSyntaxBatch.mockImplementationOnce(async () => {
      throw new Error(message);
    });
  const groupSizes = (t: ReturnType<typeof syntaxSetup>) =>
    t.analyzeSyntaxBatch.mock.calls.map(([members]) => members.length);
  it('sends a section in one counted request and marks every paragraph', async () => {
    const t = syntaxSetup();
    t.run.callsByStep = {};
    const result = await runBatch(t.run, t.deps);
    expect(groupSizes(t)).toEqual([3]);
    expect(t.analyzeSyntaxBatch.mock.calls[0]?.[0][2]?.analysisId).toBe('analysis-p2');
    expect(result.callsUsed).toBe(1);
    expect(result.callsByStep).toEqual({ syntax: 1 });
    expect(result.items.every((item) => item.status === 'done' && item.stepsDone[0] === 'syntax')).toBe(true);
  });
  it('retries the paragraph alone when the shared request fails, so others keep their turn', async () => {
    const t = syntaxSetup();
    failOnce(t, 'invalid output');
    const result = await runBatch(t.run, t.deps);
    expect(groupSizes(t)).toEqual([3, 1, 2]);
    expect(result.items.every((item) => item.status === 'done')).toBe(true);
  });
  it('marks only the paragraph as failed when it also fails alone', async () => {
    const t = syntaxSetup();
    failOnce(t, 'invalid output');
    failOnce(t, 'still invalid');
    const result = await runBatch(t.run, t.deps);
    expect(result.items.map((item) => item.status)).toEqual(['failed', 'done', 'done']);
    expect(result.items[0]?.error).toBe('still invalid');
  });
  it('leaves a paragraph the model skipped for its own request', async () => {
    const t = syntaxSetup();
    t.analyzeSyntaxBatch.mockImplementationOnce(async () => ['p0', 'p1']);
    const result = await runBatch(t.run, t.deps);
    expect(groupSizes(t)).toEqual([3, 1]);
    expect(result.items.every((item) => item.status === 'done')).toBe(true);
  });
  it('asks again alone when the model skipped the paragraph that started the request', async () => {
    const t = syntaxSetup();
    t.analyzeSyntaxBatch.mockImplementationOnce(async () => ['p1', 'p2']);
    const result = await runBatch(t.run, t.deps);
    expect(groupSizes(t)).toEqual([3, 1]);
    expect(result.items[0]?.stepsDone).toEqual(['syntax']);
  });
  it('fails clearly if even a lone request completes nothing', async () => {
    const t = syntaxSetup();
    t.analyzeSyntaxBatch.mockImplementation(async () => []);
    const result = await runBatch(t.run, t.deps);
    expect(result.items[0]?.error).toBe('Model returned no syntax for this paragraph');
  });
  it('leaves out cached paragraphs and survives one that cannot be prepared', async () => {
    const t = syntaxSetup();
    const findCached = vi.fn<NonNullable<BatchDeps['findCached']>>(async (paragraph) =>
      paragraph.id === 'p1' ? 'cached-p1' : null,
    );
    t.analyze.mockImplementation(async (paragraph) => {
      if (paragraph.id === 'p2') throw new Error('no text');
      return `analysis-${paragraph.id}`;
    });
    const result = await runBatch(t.run, { ...t.deps, findCached });
    expect(groupSizes(t)[0]).toBe(1);
    expect(result.items.map((item) => item.status)).toEqual(['done', 'cached', 'failed']);
    expect(result.items[2]?.error).toBe('no text');
  });
  it('stops at the budget before the shared request and keeps paragraphs pending', async () => {
    const t = syntaxSetup(0);
    const result = await runBatch(t.run, t.deps);
    expect(result.status).toBe('budget_exceeded');
    expect(result.items.every((item) => item.status === 'pending')).toBe(true);
  });
  it('pauses while waiting to retry and resumes without losing the paragraph', async () => {
    const t = syntaxSetup();
    const signal: BatchSignal = {};
    t.analyzeSyntaxBatch.mockImplementationOnce(async () => {
      throw Object.assign(new Error('busy'), { status: 429 });
    });
    t.sleep.mockImplementationOnce(async () => {
      signal.action = 'pause';
    });
    const paused = await runBatch(t.run, t.deps, signal);
    expect(paused.status).toBe('paused');
    expect(paused.items[0]?.status).toBe('pending');
    expect((await runBatch(paused, t.deps)).status).toBe('done');
  });
  it('records calibration for each paragraph in the request', async () => {
    const t = syntaxSetup();
    t.run.calibrationSnapshots = {};
    const recordCalibration = vi.fn<NonNullable<BatchDeps['recordCalibration']>>(async () => {});
    const captureCalibration = vi.fn(async () => []);
    await runBatch(t.run, { ...t.deps, captureCalibration, recordCalibration });
    expect(recordCalibration.mock.calls.filter((call) => call[1] === 'syntax')).toHaveLength(3);
  });
});
