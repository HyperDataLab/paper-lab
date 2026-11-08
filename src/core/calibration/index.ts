import type { Analysis, CalibrationLabel, Paper, PaperChecksRecord, PaperReviewsRecord } from '../schemas';
import { CalibrationLabelsSchema } from '../schemas';

export type CalibrationStore = {
  analyses: Analysis[];
  papers: Paper[];
  checks: PaperChecksRecord[];
  reviews: PaperReviewsRecord[];
};
type Target = CalibrationLabel['target'];
type FindingLabel = Extract<CalibrationLabel, { label: string }>;
type ScoreLabel = Extract<CalibrationLabel, { label: number }>;
const key = (target: Target) =>
  target.kind === 'score'
    ? JSON.stringify([target.kind, target.textHash, target.dimension])
    : JSON.stringify([target.kind, target.textHash, target.type, target.quote]);
const excerpt = (text: string, start: number, end: number) => Array.from(text).slice(start, end).join('');

export function collectTargets(store: CalibrationStore) {
  const targets: Target[] = [];
  const decisions: CalibrationLabel[] = [];
  const add = (target: Target, status?: string, note?: string) => {
    targets.push(target);
    if (target.kind !== 'score' && (status === 'confirmed_by_human' || status === 'dismissed_by_human'))
      decisions.push({
        rater: 'local',
        target,
        label: status === 'confirmed_by_human' ? 'correct' : 'incorrect',
        ...(note ? { note } : {}),
      });
  };
  for (const analysis of store.analyses) {
    for (const issue of analysis.issues)
      for (const span of issue.spans) {
        const quote = excerpt(analysis.text.sourceText, span.start, span.end);
        if (quote)
          add({ kind: 'issue', type: issue.type, textHash: analysis.text.sourceHash, quote }, issue.status);
      }
    for (const score of analysis.scores?.dimensions ?? [])
      if (score.rubric !== null)
        add({ kind: 'score', dimension: score.id, textHash: analysis.text.sourceHash });
  }
  for (const paper of store.papers) {
    const paragraphs = new Map(paper.paragraphs.map((p) => [p.id, p]));
    for (const record of store.checks.filter((v) => v.paperId === paper.id))
      for (const check of record.report.checks)
        for (const finding of check.findings)
          for (const location of finding.locations) {
            const paragraph = paragraphs.get(location.paragraphId);
            if (!paragraph) continue;
            const quote = excerpt(paragraph.text, location.start, location.end);
            const decision = record.decisions.find((v) => v.findingId === finding.id);
            if (quote)
              add(
                { kind: 'check', type: check.id, textHash: paragraph.textHash, quote },
                decision?.status,
                decision?.note,
              );
          }
    for (const record of store.reviews.filter((v) => v.paperId === paper.id))
      for (const run of record.runs)
        for (const point of run.merged) {
          const paragraph = paragraphs.get(point.anchor.paragraphId);
          if (!paragraph) continue;
          const quote = excerpt(paragraph.text, point.anchor.start, point.anchor.end);
          const decision = record.decisions.find((v) => v.pointId === point.id);
          if (quote)
            for (const lens of point.lenses)
              add(
                { kind: 'point', type: lens, textHash: paragraph.textHash, quote },
                decision?.status,
                decision?.note,
              );
        }
  }
  return { targets, decisions };
}
export function collectDecisions(store: CalibrationStore) {
  return collectTargets(store).decisions;
}
export function labelTemplate() {
  return CalibrationLabelsSchema.parse({ format: 'paragraph-lab-labels', version: 1, labels: [] });
}
export function matchLabels(labels: CalibrationLabel[], store: CalibrationStore) {
  const keys = new Set(collectTargets(store).targets.map(key));
  return {
    matched: labels.filter((label) => keys.has(key(label.target))),
    unmatched: labels.filter((label) => !keys.has(key(label.target))),
  };
}

export function precisionByType(
  labels: FindingLabel[],
  types: { kind: FindingLabel['target']['kind']; type: string }[] = [],
) {
  const groups = new Map<
    string,
    { kind: FindingLabel['target']['kind']; type: string; correct: number; incorrect: number }
  >();
  for (const target of [...types, ...labels.map((v) => v.target)]) {
    const id = JSON.stringify([target.kind, target.type]);
    if (!groups.has(id)) groups.set(id, { kind: target.kind, type: target.type, correct: 0, incorrect: 0 });
  }
  for (const label of labels) {
    const group = groups.get(JSON.stringify([label.target.kind, label.target.type]));
    if (group) group[label.label]++;
  }
  return [...groups.values()].map((group) => {
    const n = group.correct + group.incorrect;
    if (!n) return { ...group, n, precision: null, wilsonLow: null, wilsonHigh: null };
    const p = group.correct / n,
      z = 1.959963984540054,
      denominator = 1 + (z * z) / n;
    const center = (p + (z * z) / (2 * n)) / denominator;
    const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
    return {
      ...group,
      n,
      precision: p,
      wilsonLow: Math.max(0, center - margin),
      wilsonHigh: Math.min(1, center + margin),
    };
  });
}
// Product defaults, subject to calibration against a human benchmark.
export const MIN_CALIBRATION_N = 30;
export const MIN_WILSON_LOW = 0.65;
export function calibrationStatus(stats: { n: number; wilsonLow: number | null }) {
  return stats.n < MIN_CALIBRATION_N || stats.wilsonLow === null
    ? 'uncalibrated'
    : stats.wilsonLow >= MIN_WILSON_LOW
      ? 'reliable'
      : 'unreliable';
}

export function kappa(pairs: [number, number][], weighted = false) {
  const n = pairs.length;
  if (!n) return { n, kappa: null };
  const distance = (a: number, b: number) => (weighted ? ((a - b) / 4) ** 2 : Number(a !== b));
  const observed = pairs.reduce((sum, [a, b]) => sum + distance(a, b), 0) / n;
  let expected = 0;
  for (const [a] of pairs) for (const [, b] of pairs) expected += distance(a, b) / (n * n);
  return { n, kappa: expected === 0 ? null : 1 - observed / expected };
}
export function interRaterAgreement(labels: CalibrationLabel[], raterA: string, raterB: string) {
  if (raterA === raterB) return [];
  const targets = new Map<string, Map<string, CalibrationLabel[]>>();
  for (const label of labels.filter((v) => v.rater === raterA || v.rater === raterB)) {
    const id = key(label.target),
      byRater = targets.get(id) ?? new Map<string, CalibrationLabel[]>();
    byRater.set(label.rater, [...(byRater.get(label.rater) ?? []), label]);
    targets.set(id, byRater);
  }
  const groups = new Map<string, { kind: Target['kind']; type: string; pairs: [number, number][] }>();
  for (const byRater of targets.values()) {
    const a = byRater.get(raterA),
      b = byRater.get(raterB);
    const target = (a?.[0] ?? b?.[0])?.target;
    if (!target) continue;
    const type = target.kind === 'score' ? target.dimension : target.type;
    const id = JSON.stringify([target.kind, type]),
      group = groups.get(id) ?? { kind: target.kind, type, pairs: [] };
    groups.set(id, group);
    if (!a || !b || a.length !== 1 || b.length !== 1 || !a[0] || !b[0]) continue;
    const value = (v: CalibrationLabel) =>
      typeof v.label === 'number' ? v.label : Number(v.label === 'correct');
    group.pairs.push([value(a[0]), value(b[0])]);
  }
  return [...groups.values()].map(({ kind, type, pairs }) => ({
    kind,
    type,
    ...kappa(pairs, kind === 'score'),
  }));
}
export function scoreCalibration(labels: ScoreLabel[], analyses: Analysis[]) {
  const groups = new Map<string, [number, number][]>();
  for (const label of labels) {
    const scores = analyses
      .filter((a) => a.text.sourceHash === label.target.textHash)
      .flatMap(
        (a) =>
          a.scores?.dimensions
            .filter((d) => d.id === label.target.dimension && d.rubric !== null)
            .map((d) => d.rubric) ?? [],
      );
    const distinct = [...new Set(scores)];
    const model = distinct[0];
    if (distinct.length !== 1 || model === null || model === undefined) continue;
    const pairs = groups.get(label.target.dimension) ?? [];
    pairs.push([label.label, model]);
    groups.set(label.target.dimension, pairs);
  }
  return [...groups].map(([dimension, pairs]) => ({
    dimension,
    n: pairs.length,
    mae: pairs.reduce((s, [human, model]) => s + Math.abs(model - human), 0) / pairs.length,
    bias: pairs.reduce((s, [human, model]) => s + model - human, 0) / pairs.length,
    weightedKappa: kappa(pairs, true).kappa,
  }));
}
