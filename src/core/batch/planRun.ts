import { SYNTAX_BATCH_SENTENCES } from '../prompts/sentenceSyntax';
import type { BatchStep, Paper, RunPlan } from '../schemas';
import { segmentSentences } from '../text/segment';

/**
 * Fills requests in reading order without splitting a paragraph between them. A paragraph longer than one
 * request stands alone; the analyzer then sends it in several requests.
 */
export function groupSyntaxBatches<T>(items: T[], sentenceCount: (item: T) => number): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let used = 0;
  for (const item of items) {
    const size = sentenceCount(item);
    if (current.length && used + size > SYNTAX_BATCH_SENTENCES) {
      groups.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += size;
  }
  if (current.length) groups.push(current);
  return groups;
}

export const sentenceCountOf = (text: string) => segmentSentences(text).length;

function syntaxCalls(paragraphs: { sectionId: string; text: string }[]) {
  const sections = new Map<string, number[]>();
  for (const paragraph of paragraphs) {
    sections.set(paragraph.sectionId, [
      ...(sections.get(paragraph.sectionId) ?? []),
      sentenceCountOf(paragraph.text),
    ]);
  }
  return [...sections.values()].reduce(
    (sum, sizes) =>
      sum +
      groupSyntaxBatches(sizes, (size) => size).reduce(
        (calls, group) =>
          calls + Math.max(1, Math.ceil(group.reduce((a, b) => a + b, 0) / SYNTAX_BATCH_SENTENCES)),
        0,
      ),
    0,
  );
}

export function planRun(
  paper: Paper,
  options: { sectionIds: string[]; steps: BatchStep[]; budget: number },
): RunPlan {
  const selected = new Set(options.sectionIds);
  const paragraphs = paper.paragraphs.filter((p) => selected.has(p.sectionId) && p.kind === 'body');
  const skipped = paper.paragraphs
    .filter((p) => p.kind !== 'body')
    .map((p) => ({ paragraphId: p.id, reason: p.kind }));
  const calls = {
    syntax: options.steps.includes('syntax') ? syntaxCalls(paragraphs) : 0,
    judge: options.steps.includes('judge') ? paragraphs.length : 0,
    structure: options.steps.includes('structure') ? paragraphs.length : 0,
    score: options.steps.includes('score') ? paragraphs.length : 0,
    ...(options.steps.includes('transitions')
      ? {
          transitions: paper.sections
            .filter((section) => selected.has(section.id))
            .reduce(
              (sum, section) =>
                sum +
                Math.ceil(Math.max(0, paragraphs.filter((p) => p.sectionId === section.id).length - 1) / 12),
              0,
            ),
        }
      : {}),
  };
  const total = Object.values(calls).reduce((a, b) => a + b, 0);
  return {
    ...options,
    paragraphs: paragraphs.map(({ id, sectionId, textHash }) => ({ paragraphId: id, sectionId, textHash })),
    skipped,
    calls,
    total,
    withinBudget: total <= options.budget,
  };
}
