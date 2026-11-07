import type { BatchStep, Paper, RunPlan } from '../schemas';
import { segmentSentences } from '../text/segment';

export function planRun(
  paper: Paper,
  options: { sectionIds: string[]; steps: BatchStep[]; budget: number },
): RunPlan {
  const selected = new Set(options.sectionIds);
  const paragraphs = paper.paragraphs.filter((p) => selected.has(p.sectionId) && p.kind === 'body');
  const skipped = paper.paragraphs
    .filter((p) => p.kind !== 'body')
    .map((p) => ({ paragraphId: p.id, reason: p.kind }));
  const syntax = paper.sections.reduce((sum, section) => {
    const count = paragraphs
      .filter((p) => p.sectionId === section.id)
      .reduce((n, p) => n + segmentSentences(p.text).length, 0);
    return sum + Math.ceil(count / 40);
  }, 0);
  const calls = {
    syntax: options.steps.includes('syntax') ? syntax : 0,
    judge: options.steps.includes('judge') ? paragraphs.length : 0,
    structure: options.steps.includes('structure') ? paragraphs.length : 0,
    score: options.steps.includes('score') ? paragraphs.length : 0,
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
