import { currentArtifact } from './artifacts';
import { STAGES } from './contracts';
import type { Run, StageState } from './record';
import { isSerious } from './reviews';

export function carryObligations(run: Run, state: StageState): Run['obligations'] {
  const { stage, attempt, critic } = state;
  const targetStage = STAGES[STAGES.indexOf(stage) + 1] ?? stage;
  const points =
    critic?.points.filter((point) => isSerious(point) || point.fixClass === 'needs_evidence') ?? [];
  const newObligations = points.filter(
    (point) =>
      !run.obligations.some(
        (item) =>
          item.sourceStage === stage &&
          item.findingId === point.id &&
          item.status !== 'controlled' &&
          item.text === point.text,
      ),
  );
  return [
    ...run.obligations,
    ...newObligations.map((point) => ({
      id: `${stage}:${attempt}:${point.id}`,
      sourceStage: stage,
      itemId: point.itemId,
      findingId: point.id,
      text: point.text,
      targetStage,
      status: 'open' as const,
      locator: null,
      note: null,
    })),
  ];
}

export function closeObligations(run: Run): Run['obligations'] {
  return run.obligations.map((item) => {
    const target = currentArtifact(run, item.targetStage);
    if (item.status === 'controlled' && target?.status === 'accepted' && target.hash === item.locator)
      return item;
    return { ...item, status: 'unresolved', locator: null };
  });
}
