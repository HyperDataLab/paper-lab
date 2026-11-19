import {
  calibrationStatus,
  collectTargets,
  deduplicateLabels,
  matchLabels,
  precisionByType,
} from '@/core/calibration';
import type { CalibrationLabel, ExportPackage } from '@/core/schemas';
import type { Repositories } from '@/shared/storage/types';
export async function loadCalibration(repo: Repositories) {
  return calibrationData(await repo.transfer.exportAll('0.1.0'));
}
export function calibrationData(data: ExportPackage) {
  const store = {
    analyses: data.analyses,
    papers: data.papers,
    checks: data.paperChecks,
    reviews: data.paperReviews,
    auditEvents: data.auditEvents,
  };
  const collected = collectTargets(store);
  const imported = data.calibrationLabels.flatMap((set) =>
    matchLabels(set.data.labels, store).matched.map((label) => ({ label, at: set.importedAt })),
  );
  const { labels, conflicts } = deduplicateLabels([...imported, ...collected.timedDecisions]);
  const targets = collected.targets;
  const findings = labels.filter(
    (label): label is Extract<CalibrationLabel, { label: string }> => typeof label.label === 'string',
  );
  return {
    data,
    store,
    labels,
    conflicts,
    targets,
    stats: precisionByType(
      findings,
      targets.filter((target) => target.kind !== 'score'),
    ),
  };
}
export type CalibrationData = ReturnType<typeof calibrationData>;
export async function captureCalibration(repo: Repositories) {
  return (await loadCalibration(repo)).stats.map(({ kind, type, n, wilsonLow }) => ({
    kind,
    type,
    n,
    status: calibrationStatus({ n, wilsonLow }),
  }));
}
