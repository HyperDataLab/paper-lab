import type { BatchStep, Paper, PaperParagraph, PaperRun } from '../schemas';
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
  ) => Promise<string>;
  save: (run: PaperRun) => Promise<unknown>;
  now: () => string;
  sleep: (ms: number) => Promise<void>;
  findCached?: (paragraph: PaperParagraph, run: PaperRun) => Promise<string | null>;
};

function retryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('status' in error && typeof error.status === 'number')
    return error.status === 429 || error.status >= 500;
  return (
    error instanceof Error &&
    ['LlmNetworkError', 'LlmTimeoutError', 'TypeError'].includes(error.constructor.name)
  );
}

function contextFor(paper: Paper, paragraph: PaperParagraph): PaperContext {
  const section = paper.sections.find((s) => s.id === paragraph.sectionId);
  if (!section) throw new Error('Section not found');
  const neighbours = paper.paragraphs
    .filter((p) => p.sectionId === section.id && p.kind === 'body')
    .sort((a, b) => a.order - b.order);
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
        item.analysisId = await deps.analyze(paragraph, contextFor(deps.paper, paragraph), 'detectors', null);
        await checkpoint();
      }
      for (const step of run.plan.steps) {
        if (item.stepsDone.includes(step)) continue;
        if (await stop()) {
          item.status = 'pending';
          await checkpoint();
          return run;
        }
        let attempt = 0;
        for (;;) {
          if (run.callsUsed >= run.budget) {
            item.status = 'pending';
            run.status = 'budget_exceeded';
            await checkpoint();
            return run;
          }
          run.callsUsed++;
          item.calls++;
          await checkpoint();
          try {
            item.analysisId = await deps.analyze(
              paragraph,
              contextFor(deps.paper, paragraph),
              step,
              item.analysisId,
            );
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
      item.status = 'failed';
      item.error = error instanceof Error ? error.message : String(error);
    }
    await checkpoint();
  }
  run.status = 'done';
  await checkpoint();
  return run;
}
