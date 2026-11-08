import type { BatchStep, Paper, RunPlan } from '../schemas';

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
    syntax: options.steps.includes('syntax') ? paragraphs.length : 0,
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
