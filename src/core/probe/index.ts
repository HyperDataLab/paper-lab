import { meaningChecks } from '../revision/meaningChecks';
import type { Analysis, Paper, PaperParagraph } from '../schemas';
import type { Scores } from '../schemas/scores';
import { DIMENSIONS } from '../scoring/rubric';
import { PROMPT_VERSIONS } from '../prompts';

export const PROBE_MINIMUM = 3;
export const PROBE_DEFAULT = 5;
export const PROBE_MAXIMUM = 10;
// Product heuristics, pending calibration against labelled test–retest data.
export const PROBE_DELTA_THRESHOLD = 5;
export const PROBE_NOISE_MULTIPLIER = 2;
// One rubric level is 25 points: a single level change on one paragraph is not evidence of a style effect.
export const PROBE_RUBRIC_STEP = 25;

function hash(value: string): number {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ (char.codePointAt(0) ?? 0), 16777619);
  return result >>> 0;
}

export function selectProbeParagraphs(
  paper: Paper,
  analyses: Analysis[],
  model: string,
  n = PROBE_DEFAULT,
  seed = paper.id,
) {
  if (!Number.isInteger(n) || n < PROBE_MINIMUM || n > PROBE_MAXIMUM)
    throw new Error('Invalid probe sample size');
  const eligible = paper.paragraphs.filter(
    (paragraph) =>
      paragraph.kind === 'body' &&
      analyses.some(
        (analysis) =>
          analysis.origin?.kind === 'paper' &&
          analysis.origin.paperId === paper.id &&
          analysis.origin.paragraphId === paragraph.id &&
          analysis.text.sourceHash === paragraph.textHash &&
          analysis.versions.scoringPrompt === PROMPT_VERSIONS.scoringPaper &&
          analysis.versions.scoringModel === model &&
          analysis.scores?.dimensions.some((dimension) => dimension.applicable && dimension.score !== null),
      ),
  );
  if (eligible.length < PROBE_MINIMUM) throw new Error('Cần chấm điểm ít nhất 3 đoạn trước');
  const groups = new Map<string, PaperParagraph[]>();
  for (const paragraph of eligible) {
    const group = groups.get(paragraph.sectionId) ?? [];
    group.push(paragraph);
    groups.set(paragraph.sectionId, group);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => hash(`${seed}:${a}`) - hash(`${seed}:${b}`));
  for (const [, group] of ordered) group.sort((a, b) => hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`));
  const selected: PaperParagraph[] = [];
  while (selected.length < Math.min(n, eligible.length)) {
    for (const [, group] of ordered) {
      const next = group.shift();
      if (next) selected.push(next);
      if (selected.length === Math.min(n, eligible.length)) break;
    }
  }
  return selected;
}

export function estimateProbe(analyses: Analysis[]) {
  return analyses.reduce(
    (sum, analysis) => sum + 4 + (analysis.versions.judgePrompt ? 1 : 0) + (analysis.paragraph ? 1 : 0),
    0,
  );
}

export function validateProbe(original: string, rewritten: string, preserveTerms: string[] = []) {
  // A style-only rewrite may reorder clauses, so compare over the whole paragraph rather than by position.
  const checks = meaningChecks(original, rewritten, preserveTerms, { orderInsensitive: true });
  const reasons = checks
    .filter(
      (check) => check.status === 'fail' || (check.id === 'hedging_preserved' && check.status === 'warn'),
    )
    .map((check) => check.detail);
  if (original === rewritten) reasons.push('không có thay đổi');
  return { valid: reasons.length === 0, reasons, checks };
}

export type ProbeItem = {
  original: Scores | null;
  rewritten: Scores | null;
  baseline: Scores | null;
};
export type ProbeMetric = {
  meanDelta: number | null;
  meanAbsDelta: number | null;
  meanNoise: number | null;
  n: number;
};

export function summariseProbe(items: ProbeItem[]) {
  const metric = (values: { original: number; rewritten: number; baseline: number }[]): ProbeMetric => {
    const n = values.length;
    if (!n) return { meanDelta: null, meanAbsDelta: null, meanNoise: null, n };
    return {
      meanDelta: values.reduce((sum, v) => sum + v.rewritten - v.original, 0) / n,
      meanAbsDelta: values.reduce((sum, v) => sum + Math.abs(v.rewritten - v.original), 0) / n,
      meanNoise: values.reduce((sum, v) => sum + Math.abs(v.baseline - v.original), 0) / n,
      n,
    };
  };
  const dimensions = Object.fromEntries(
    DIMENSIONS.map(({ id }) => [
      id,
      metric(
        items.flatMap((item) => {
          const a = item.original?.dimensions.find((d) => d.id === id);
          const b = item.rewritten?.dimensions.find((d) => d.id === id);
          const c = item.baseline?.dimensions.find((d) => d.id === id);
          return a?.applicable &&
            b?.applicable &&
            c?.applicable &&
            a.score !== null &&
            b.score !== null &&
            c.score !== null
            ? [{ original: a.score, rewritten: b.score, baseline: c.score }]
            : [];
        }),
      ),
    ]),
  );
  const overall = metric(
    items.flatMap(({ original, rewritten, baseline }) => {
      const applicable = (scores: Scores) =>
        scores.dimensions
          .filter((d) => d.applicable && d.score !== null)
          .map((d) => d.id)
          .sort()
          .join('|');
      return original?.overall != null &&
        rewritten?.overall != null &&
        baseline?.overall != null &&
        applicable(original) === applicable(rewritten) &&
        applicable(original) === applicable(baseline)
        ? [
            {
              original: original.overall,
              rewritten: rewritten.overall,
              baseline: baseline.overall,
            },
          ]
        : [];
    }),
  );
  const metrics = [overall, ...Object.values(dimensions)];
  const sensitive = metrics.some(
    (value) =>
      value.n >= PROBE_MINIMUM &&
      value.meanDelta !== null &&
      value.meanNoise !== null &&
      Math.abs(value.meanDelta) >
        Math.max(
          PROBE_DELTA_THRESHOLD,
          PROBE_NOISE_MULTIPLIER * value.meanNoise,
          PROBE_RUBRIC_STEP / value.n,
        ),
  );
  return {
    overall,
    dimensions,
    verdict: !metrics.some((value) => value.n >= PROBE_MINIMUM)
      ? ('insufficient' as const)
      : sensitive
        ? ('style_sensitive' as const)
        : ('stable' as const),
  };
}

/** Date of the latest finished probe when it found the scorer style-sensitive, otherwise null. */
export function latestStyleWarning(
  runs: { status: string; updatedAt: string; summary: { verdict: string } }[] | undefined,
): string | null {
  const latest = (runs ?? [])
    .filter((run) => run.status === 'done')
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .at(-1);
  return latest?.summary.verdict === 'style_sensitive' ? latest.updatedAt : null;
}
