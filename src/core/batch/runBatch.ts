import type {
  BatchStep,
  CalibrationSnapshot,
  Paper,
  PaperParagraph,
  PaperRun,
  TransitionPair,
} from '../schemas';
import type { PaperContext } from '../prompts/paperContext';
import { segmentSentences } from '../text/segment';
import { sliceCp } from '../text/offsets';

export type BatchSignal = { action?: 'pause' | 'cancel' };
export type BatchDeps = {
  paper: Paper;
  analyze: (
    paragraph: PaperParagraph,
    context: PaperContext,
    step: BatchStep | 'detectors',
    analysisId: string | null,
    onRequest?: () => Promise<void>,
  ) => Promise<string>;
  save: (run: PaperRun) => Promise<unknown>;
  now: () => string;
  sleep: (ms: number) => Promise<void>;
  findCached?: (paragraph: PaperParagraph, run: PaperRun) => Promise<string | null>;
  getTransitionPairs?: () => Promise<TransitionPair[]>;
  analyzeTransitions?: (pairs: TransitionPair[], onRequest: () => Promise<void>) => Promise<void>;
  captureCalibration?: () => Promise<CalibrationSnapshot>;
  recordCalibration?: (
    analysisId: string,
    step: BatchStep | 'detectors',
    snapshot: CalibrationSnapshot,
  ) => Promise<void>;
};
export class BatchBudgetExceededError extends Error {}

function retryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('status' in error && typeof error.status === 'number')
    return error.status === 429 || error.status >= 500;
  return (
    error instanceof Error &&
    ['LlmNetworkError', 'LlmTimeoutError', 'TypeError'].includes(error.constructor.name)
  );
}

export function contextFor(paper: Paper, paragraph: PaperParagraph): PaperContext {
  const section = paper.sections.find((s) => s.id === paragraph.sectionId);
  if (!section) throw new Error('Section not found');
  const neighbours = paper.paragraphs
    .filter((p) => p.kind === 'body')
    .sort(
      (a, b) =>
        paper.sections.findIndex((s) => s.id === a.sectionId) -
          paper.sections.findIndex((s) => s.id === b.sectionId) || a.order - b.order,
    );
  const index = neighbours.findIndex((p) => p.id === paragraph.id);
  const firstOrLast = (p: PaperParagraph | undefined, last: boolean) => {
    if (!p) return null;
    const sentences = segmentSentences(p.text);
    const sentence = last ? sentences.at(-1) : sentences[0];
    return sentence ? sliceCp(p.text, sentence.start, sentence.end) : null;
  };
  return {
    role: section.role,
    heading: section.heading,
    previousLast: firstOrLast(neighbours[index - 1], true),
    nextFirst: firstOrLast(neighbours[index + 1], false),
  };
}

export async function runBatch(
  input: PaperRun,
  deps: BatchDeps,
  signal: BatchSignal = {},
): Promise<PaperRun> {
  const run = structuredClone(input);
  const snapshot = async (step: BatchStep | 'detectors') => {
    if (!deps.captureCalibration) return;
    run.calibrationSnapshots ??= {};
    if (!(step in run.calibrationSnapshots)) run.calibrationSnapshots[step] = await deps.captureCalibration();
  };
  const checkpoint = async () => {
    run.updatedAt = deps.now();
    await deps.save(structuredClone(run));
  };
  const stop = async () => {
    if (!signal.action) return false;
    run.status = signal.action === 'pause' ? 'paused' : 'cancelled';
    await checkpoint();
    return true;
  };
  run.status = 'running';
  await checkpoint();
  for (const item of run.items) {
    if (['done', 'cached', 'skipped'].includes(item.status)) continue;
    if (await stop()) return run;
    const paragraph = deps.paper.paragraphs.find(
      (p) => p.id === item.paragraphId && p.textHash === item.textHash,
    );
    if (!paragraph) {
      item.status = 'failed';
      item.error = 'Paragraph not found or changed';
      await checkpoint();
      continue;
    }
    try {
      if (!item.analysisId && deps.findCached) {
        const cached = await deps.findCached(paragraph, run);
        if (cached) {
          item.analysisId = cached;
          item.status = 'cached';
          await checkpoint();
          continue;
        }
      }
      item.status = 'running';
      item.error = null;
      if (!item.analysisId) {
        await snapshot('detectors');
        item.analysisId = await deps.analyze(paragraph, contextFor(deps.paper, paragraph), 'detectors', null);
        const calibration = run.calibrationSnapshots?.detectors;
        if (calibration && deps.recordCalibration)
          await deps.recordCalibration(item.analysisId, 'detectors', calibration);
        await checkpoint();
      }
      for (const step of run.plan.steps) {
        if (step === 'transitions') continue;
        if (item.stepsDone.includes(step)) continue;
        if (await stop()) {
          item.status = 'pending';
          await checkpoint();
          return run;
        }
        let attempt = 0;
        await snapshot(step);
        for (;;) {
          try {
            item.analysisId = await deps.analyze(
              paragraph,
              contextFor(deps.paper, paragraph),
              step,
              item.analysisId,
              async () => {
                if (run.callsUsed >= run.budget) throw new BatchBudgetExceededError();
                run.callsUsed++;
                if (run.callsByStep) run.callsByStep[step] = (run.callsByStep[step] ?? 0) + 1;
                item.calls++;
                await checkpoint();
              },
            );
            const calibration = run.calibrationSnapshots?.[step];
            if (calibration && deps.recordCalibration)
              await deps.recordCalibration(item.analysisId, step, calibration);
            break;
          } catch (error) {
            if (!retryable(error) || attempt >= 3) throw error;
            await deps.sleep(1000 * 2 ** attempt++);
            if (await stop()) {
              item.status = 'pending';
              await checkpoint();
              return run;
            }
          }
        }
        item.stepsDone.push(step);
        await checkpoint();
      }
      item.status = 'done';
    } catch (error) {
      if (error instanceof BatchBudgetExceededError) {
        item.status = 'pending';
        run.status = 'budget_exceeded';
        await checkpoint();
        return run;
      }
      item.status = 'failed';
      item.error = error instanceof Error ? error.message : String(error);
    }
    await checkpoint();
  }
  if (run.plan.steps.includes('transitions')) {
    if (!deps.getTransitionPairs || !deps.analyzeTransitions)
      throw new Error('Transition provider not configured');
    const pairs = await deps.getTransitionPairs();
    run.transitionDone ??= [];
    for (const section of deps.paper.sections.filter((s) => run.plan.sectionIds.includes(s.id))) {
      const available = pairs.filter((p) => p.sectionId === section.id);
      const bodies = deps.paper.paragraphs
        .filter((p) => p.sectionId === section.id && p.kind === 'body')
        .sort((a, b) => a.order - b.order);
      for (let i = 1; i < bodies.length; i++) {
        const from = bodies[i - 1];
        const to = bodies[i];
        if (
          from &&
          to &&
          !available.some((p) => p.from.paragraphId === from.id && p.to.paragraphId === to.id)
        ) {
          const paragraphId = `${from.id}->${to.id}`;
          if (!run.plan.skipped.some((s) => s.paragraphId === paragraphId))
            run.plan.skipped.push({ paragraphId, reason: 'missing syntax annotations' });
        }
      }
      for (let i = 0; i < available.length; i += 12) {
        const chunk = available.slice(i, i + 12).filter((p) => !run.transitionDone?.includes(p.pairId));
        if (!chunk.length) continue;
        if (await stop()) return run;
        try {
          await snapshot('transitions');
          let attempt = 0;
          for (;;) {
            try {
              await deps.analyzeTransitions(chunk, async () => {
                if (run.callsUsed >= run.budget) throw new BatchBudgetExceededError();
                run.callsUsed++;
                if (run.callsByStep) run.callsByStep.transitions = (run.callsByStep.transitions ?? 0) + 1;
                await checkpoint();
              });
              break;
            } catch (error) {
              if (!retryable(error) || attempt >= 3) throw error;
              await deps.sleep(1000 * 2 ** attempt++);
              if (await stop()) return run;
            }
          }
        } catch (error) {
          run.status = error instanceof BatchBudgetExceededError ? 'budget_exceeded' : 'failed';
          await checkpoint();
          return run;
        }
        run.transitionDone.push(...chunk.map((p) => p.pairId));
        await checkpoint();
      }
    }
  }
  run.status = 'done';
  await checkpoint();
  return run;
}
