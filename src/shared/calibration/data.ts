import { collectDecisions, collectTargets, matchLabels, precisionByType } from '@/core/calibration';
import type { CalibrationLabel, ExportPackage } from '@/core/schemas';
import type { Repositories } from '@/shared/storage/repositories';
export async function loadCalibration(repo: Repositories) {
  return calibrationData(await repo.transfer.exportAll('0.1.0'));
}
export function calibrationData(data: ExportPackage) {
  const store = {
    analyses: data.analyses,
    papers: data.papers,
    checks: data.paperChecks,
    reviews: data.paperReviews,
  };
  const labels = [
    ...matchLabels(
      data.calibrationLabels.flatMap((set) => set.data.labels),
      store,
    ).matched,
    ...collectDecisions(store),
  ];
  const targets = collectTargets(store).targets;
  const findings = labels.filter(
    (label): label is Extract<CalibrationLabel, { label: string }> => typeof label.label === 'string',
  );
  return {
    data,
    store,
    labels,
    targets,
    stats: precisionByType(
      findings,
      targets.filter((target) => target.kind !== 'score'),
    ),
  };
}
export type CalibrationData = ReturnType<typeof calibrationData>;
