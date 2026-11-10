import type { ArgumentRun, RhetoricRun, StanceRun } from './schemas';

/**
 * Running one analysis again for one section, without losing the rest of the paper's result. The new
 * run covers only the rerun sections; it is merged into the latest run so that items from other sections
 * stay as they were, items of the rerun sections are replaced, and the merged run covers the union.
 *
 * Decisions are keyed by run id and item id. The merged run gets a NEW id, because its content differs
 * from the run a person reviewed; the previous run stays in the history unchanged, and so do the audit
 * events of the decisions made on it. The decisions on items that were kept are then copied to the new
 * run id with their original time (`carryDecisions`): those items are the same words with the same
 * reasons, so the person's verdict on them still holds. Items of a rerun section start undecided.
 *
 * Item ids are positions in a run ("rh-3"), so new items are numbered after the highest kept number;
 * a decision on a replaced item can then never land on a new one.
 */
export class SectionRunMismatchError extends Error {
  constructor() {
    super('Kết quả hiện có dùng prompt hoặc model khác, nên không gộp được. Hãy phân tích lại cả bài.');
  }
}

type Merged = { id: string; createdAt: string };
const number = (id: string) => Number(/(\d+)$/u.exec(id)?.[1] ?? 0);

/** Kept items keep their ids; new items continue the numbering with the same prefix and width. */
function renumber<T extends { id: string }>(kept: T[], added: T[], prefix: string, width = 0): T[] {
  let next = Math.max(0, ...kept.map((item) => number(item.id)));
  return [
    ...kept,
    ...added.map((item) => {
      next += 1;
      return { ...item, id: `${prefix}${String(next).padStart(width, '0')}` };
    }),
  ];
}
function same(
  previous: { promptVersion: string; model: string },
  next: { promptVersion: string; model: string },
) {
  if (previous.promptVersion !== next.promptVersion || previous.model !== next.model)
    throw new SectionRunMismatchError();
}
const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
const without = (ids: string[], rerun: Set<string>) => ids.filter((id) => !rerun.has(id));

export function mergeRhetoricRuns(
  previous: RhetoricRun,
  next: RhetoricRun,
  sectionIds: string[],
  merged: Merged,
): { run: RhetoricRun; keptIds: string[] } {
  same(previous, next);
  const rerun = new Set(sectionIds);
  const kept = previous.items.filter((item) => !rerun.has(item.sectionId));
  return {
    keptIds: kept.map((item) => item.id),
    run: {
      ...previous,
      ...merged,
      callsUsed: previous.callsUsed + next.callsUsed,
      sectionIds: union(previous.sectionIds, sectionIds),
      failedSectionIds: union(without(previous.failedSectionIds, rerun), next.failedSectionIds),
      items: renumber(kept, next.items, 'rh-'),
      // The abstract is compared with the whole text; a section run does not redo it.
      abstractClaims: previous.abstractClaims,
      abstractChecked: previous.abstractChecked,
      // Counts of what code threw away, over every request whose output is in this result or was replaced.
      discarded: {
        not_found: previous.discarded.not_found + next.discarded.not_found,
        duplicate: previous.discarded.duplicate + next.discarded.duplicate,
      },
    },
  };
}

export function mergeArgumentRuns(
  previous: ArgumentRun,
  next: ArgumentRun,
  sectionIds: string[],
  merged: Merged,
): { run: ArgumentRun; keptIds: string[] } {
  same(previous, next);
  const rerun = new Set(sectionIds);
  // An argument belongs to the section of its claim.
  const kept = previous.arguments.filter((item) => !rerun.has(item.claim.sectionId));
  return {
    keptIds: kept.map((item) => item.id),
    run: {
      ...previous,
      ...merged,
      callsUsed: previous.callsUsed + next.callsUsed,
      sectionIds: union(previous.sectionIds, sectionIds),
      failedSectionIds: union(without(previous.failedSectionIds, rerun), next.failedSectionIds),
      arguments: renumber(kept, next.arguments, 'arg-'),
      discarded: {
        claim_not_found: previous.discarded.claim_not_found + next.discarded.claim_not_found,
        element_not_found: previous.discarded.element_not_found + next.discarded.element_not_found,
        duplicate: previous.discarded.duplicate + next.discarded.duplicate,
      },
    },
  };
}

export function mergeStanceRuns(
  previous: StanceRun,
  next: StanceRun,
  sectionIds: string[],
  merged: Merged,
): { run: StanceRun; keptIds: string[] } {
  same(previous, next);
  const rerun = new Set(sectionIds);
  const kept = previous.annotations.filter((item) => !rerun.has(item.sectionId));
  const words = Object.fromEntries(Object.entries(previous.words).filter(([id]) => !rerun.has(id)));
  return {
    keptIds: kept.map((item) => item.id),
    run: {
      ...previous,
      ...merged,
      callsUsed: previous.callsUsed + next.callsUsed,
      sectionIds: union(previous.sectionIds, sectionIds),
      failedSectionIds: union(without(previous.failedSectionIds, rerun), next.failedSectionIds),
      // Word counts are the denominators per section: the rerun section's come from the new read.
      words: { ...words, ...next.words },
      annotations: renumber(kept, next.annotations, 'sa-', 4),
      discarded: {
        not_found: previous.discarded.not_found + next.discarded.not_found,
        wrong_form: previous.discarded.wrong_form + next.discarded.wrong_form,
        duplicate: previous.discarded.duplicate + next.discarded.duplicate,
      },
    },
  };
}

/** The decisions on kept items, copied onto the merged run's id with their original time and verdict. */
export function carryDecisions<D extends { run_id: string }>(
  decisions: D[],
  from: string,
  to: string,
  keptIds: string[],
  itemOf: (decision: D) => string,
): D[] {
  const kept = new Set(keptIds);
  return decisions
    .filter((decision) => decision.run_id === from && kept.has(itemOf(decision)))
    .map((decision) => ({ ...decision, run_id: to }));
}
