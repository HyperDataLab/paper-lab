import { describe, expect, it } from 'vitest';
import { STYLE_PROBE_SYSTEM, PROMPT_VERSIONS } from '../prompts';
import { ScoresSchema, type Scores } from '../schemas/scores';
import { summariseProbe, validateProbe } from './index';

function score(value: number, applicable = true): Scores {
  return ScoresSchema.parse({
    rubricVersion: 'test',
    dimensions: [
      {
        id: 'sentence_structure',
        label: '',
        weight: 1,
        applicable,
        notAssessableReason: null,
        rubric: 2,
        score: value,
        descriptor: null,
        confidence: 1,
        evidence: { issueIds: [], sentenceIds: [] },
        rationale: null,
      },
    ],
    overall: value,
    overallSuppressedReason: null,
    coverage: { applicable: 1, total: 1, value: 1 },
    confidence: 1,
    contextLimited: false,
    issueSnapshot: '',
  });
}

describe('P6 probe', () => {
  it('uses the exact style-only prompt', () => {
    expect(PROMPT_VERSIONS.styleProbe).toBe('style-probe-1');
    expect(STYLE_PROBE_SYSTEM)
      .toBe(`Rewrite the paragraph changing only surface style: word order, sentence boundaries, connectives and word choice.
Keep every claim, number, unit, citation, hedge, negation and technical term exactly. Do not add or remove
information, do not make claims more confident, do not add sections, results or answers.
Return the rewritten paragraph only.`);
  });
  it('discards unchanged text and failed meaning checks', () => {
    expect(validateProbe('The result is 3 kg.', 'The result is 3 kg.').valid).toBe(false);
    expect(validateProbe('The result is 3 kg.', 'The result is 4 kg.').valid).toBe(false);
    expect(validateProbe('The result is not clear.', 'The result is clear.').valid).toBe(false);
    expect(validateProbe('Result (Smith, 2020).', 'Result (Smith, 2021).').valid).toBe(false);
    expect(validateProbe('The result suggests X.', 'The result proves X.').valid).toBe(false);
    expect(validateProbe('The kinase acts.', 'The enzyme acts.', ['kinase']).valid).toBe(false);
  });
  it('reports signed and absolute changes, baseline noise and verdicts', () => {
    const item = (delta: number, noise: number) => ({
      original: score(50),
      rewritten: score(50 + delta),
      baseline: score(50 + noise),
    });
    expect(summariseProbe([item(10, 1), item(10, 1)]).verdict).toBe('insufficient');
    const result = summariseProbe([item(10, 1), item(10, 1), item(-2, 1)]);
    expect(result.overall).toMatchObject({
      meanDelta: 6,
      meanAbsDelta: 22 / 3,
      meanNoise: 1,
      n: 3,
    });
    expect(result.verdict).toBe('style_sensitive');
    expect(summariseProbe([item(10, 6), item(10, 6), item(10, 6)]).verdict).toBe('stable');
    const inapplicable = {
      original: score(50, false),
      rewritten: score(70),
      baseline: score(50),
    };
    expect(summariseProbe([inapplicable]).dimensions.sentence_structure?.n).toBe(0);
  });
});
