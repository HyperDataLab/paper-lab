import type { Hypothesis, Inputs } from './contracts';
import { numericGrounding } from './number-grounding';
import type { ComputedResults, ResultsArtifact, ResultsTest } from './results-contract';

/** A free-form criterion needs human judgment unless it is a simple directional contrast. */
export function falsificationRule(hypothesis: Hypothesis) {
  const { criterion, threshold } = hypothesis.falsification;
  const text = criterion.toLowerCase().replace(/[.!]$/u, '');
  // Conditions, exceptions and compound criteria cannot be tested by a single contrast.
  if (/\b(?:and|or|unless|when|if|except|either|both|significantly)\b/u.test(text)) return null;
  const increasing = /(?:does not increase|fails to increase|no increase)(?:\s+\w+)*$/u.test(text);
  const decreasing = /(?:does not decrease|fails to decrease|no decrease)(?:\s+\w+)*$/u.test(text);
  const up =
    /(?:^|\s)(?:effect|difference|contrast)\s*(?:<=|≤|<|is below|is less than)\s*([+−\-\d.e]+)$/u.exec(text);
  const down =
    /(?:^|\s)(?:effect|difference|contrast)\s*(?:>=|≥|>|is above|is greater than)\s*([+−\-\d.e]+)$/u.exec(
      text,
    );
  const agrees = (match: RegExpExecArray | null) =>
    threshold !== null && match?.[1] !== undefined && Number(match[1].replace('−', '-')) === threshold;
  if (hypothesis.prediction === '> 0' && ((increasing && threshold === null) || agrees(up)))
    return { direction: 1, threshold: threshold ?? 0 };
  if (hypothesis.prediction === '< 0' && ((decreasing && threshold === null) || agrees(down)))
    return { direction: -1, threshold: threshold ?? 0 };
  if (
    hypothesis.prediction === '≠ 0' &&
    threshold === null &&
    /^(?:no (?:difference|effect|change)|(?:the )?(?:effect|difference|contrast) is zero)$/u.test(text)
  )
    return { direction: 0, threshold: 0 };
  return null;
}

export function contrastVerdict(
  rule: ReturnType<typeof falsificationRule>,
  effect: number | null,
  p: number | null,
  alpha: number,
): ResultsTest['verdict'] {
  if (!rule || effect === null || effect === 0 || p === null || p > alpha) return 'inconclusive';
  if (rule.direction === 0 || Math.sign(effect) === rule.direction) return 'supported';
  return 'refuted';
}

export function hypothesisVerdicts(ids: string[], tests: ResultsTest[]): ResultsArtifact['hypotheses'] {
  return ids.map((hypothesisId) => {
    const rows = tests.filter((test) => test.hypothesisId === hypothesisId);
    const [first] = rows;
    return {
      hypothesisId,
      verdict: first && rows.every((row) => row.verdict === first.verdict) ? first.verdict : 'inconclusive',
    };
  });
}

export function groundedInterpretation(narrative: string, { table, tests }: ComputedResults) {
  const numbers = [
    ...table.flatMap(({ n, mean, sd }) => [n, mean, sd]),
    ...tests.flatMap(({ statistic, p, corrected }) => [statistic, p, corrected]),
  ].filter((value) => value !== null);
  return numericGrounding(narrative, numbers.join(' '));
}

export function validResults(value: ResultsArtifact, prior: Inputs) {
  const ids = prior.S8?.hypotheses.map(({ id }) => id);
  return Boolean(
    prior.S10 &&
    prior.S11 &&
    ids?.length &&
    ids.every((id) => value.tests.some((test) => test.hypothesisId === id)) &&
    value.tests.every(
      (test) =>
        ids.includes(test.hypothesisId) &&
        (test.p === null) === (test.corrected === null) &&
        (test.p !== null || test.verdict === 'inconclusive'),
    ) &&
    JSON.stringify(value.hypotheses) === JSON.stringify(hypothesisVerdicts(ids, value.tests)) &&
    groundedInterpretation(value.narrative, value),
  );
}
