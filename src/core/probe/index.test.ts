import { meaningChecks } from '../revision/meaningChecks';
import { describe, expect, it } from 'vitest';
import { STYLE_PROBE_SYSTEM, PROMPT_VERSIONS } from '../prompts';
import { ScoresSchema, type Scores } from '../schemas/scores';
import { estimateProbe, selectProbeParagraphs, summariseProbe, validateProbe, type ProbeItem } from './index';
import { probeFixture } from '@/test/probeFixtures';

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
  it('P6 selects deterministically across sections and refuses fewer than three eligible bodies', async () => {
    const { paper, analyses } = await probeFixture();
    const chosen = selectProbeParagraphs(paper, analyses, 'test', 3, 'seed');
    expect(chosen).toEqual(selectProbeParagraphs(paper, analyses, 'test', 3, 'seed'));
    expect(new Set(chosen.map((p) => p.sectionId)).size).toBe(3);
    expect(selectProbeParagraphs(paper, analyses, 'test')).toHaveLength(5);
    expect(selectProbeParagraphs(paper, analyses, 'test', 10)).toHaveLength(6);
    expect(() => selectProbeParagraphs(paper, analyses.slice(0, 2), 'test')).toThrow(
      'Cần chấm điểm ít nhất 3 đoạn trước',
    );
    expect(() => selectProbeParagraphs(paper, analyses, 'test', 2)).toThrow('sample size');
    expect(() => selectProbeParagraphs(paper, analyses, 'test', 11)).toThrow('sample size');
    expect(() => selectProbeParagraphs(paper, analyses, 'test', 3.5)).toThrow('sample size');
    const altered = structuredClone(paper);
    const firstParagraph = altered.paragraphs[0];
    if (!firstParagraph) throw new Error('fixture');
    firstParagraph.kind = 'caption';
    expect(selectProbeParagraphs(altered, analyses, 'test', 10)).toHaveLength(5);
    firstParagraph.kind = 'body';
    firstParagraph.textHash = 'changed';
    expect(selectProbeParagraphs(altered, analyses, 'test', 10)).toHaveLength(5);
  });
  it('P6 requires three compatible scorer versions and models', async () => {
    const { paper, analyses } = await probeFixture();
    analyses.slice(2).forEach((a, i) => {
      if (i % 2) a.versions.scoringModel = 'other';
      else a.versions.scoringPrompt = 'old';
    });
    expect(() => selectProbeParagraphs(paper, analyses, 'test')).toThrow(
      'Cần chấm điểm ít nhất 3 đoạn trước',
    );
  });
  it('P6 estimates four requests and an extra judgement when present', async () => {
    const { analyses } = await probeFixture();
    const first = analyses[0];
    const second = analyses[1];
    if (!first || !second) throw new Error('fixture');
    expect(
      estimateProbe([first, { ...second, versions: { ...second.versions, judgePrompt: 'judge' } }]),
    ).toBe(9);
  });
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
    expect(validateProbe('The result may change.', 'The result changes.').valid).toBe(false);
    expect(validateProbe('The result changes.', 'It changes.').valid).toBe(true);
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
    // A mean of 6 over three paragraphs is less than one rubric level on one paragraph (25 / 3).
    expect(result.verdict).toBe('stable');
    expect(summariseProbe([item(12, 1), item(12, 1), item(12, 1)]).verdict).toBe('style_sensitive');
    expect(summariseProbe([item(10, 6), item(10, 6), item(10, 6)]).verdict).toBe('stable');
    expect(summariseProbe([item(5, 0), item(5, 0), item(5, 0)]).verdict).toBe('stable');
    expect(summariseProbe([item(11, 5), item(11, 5), item(11, 5)]).verdict).toBe('style_sensitive');
    const inapplicable = {
      original: score(50, false),
      rewritten: score(70),
      baseline: score(50),
    };
    expect(summariseProbe([inapplicable]).dimensions.sentence_structure?.n).toBe(0);
    expect(summariseProbe([inapplicable]).overall.n).toBe(0);
    const dimensionOnly = (value: number) => ({ ...score(value), overall: null });
    const perDimension = {
      original: dimensionOnly(50),
      rewritten: dimensionOnly(40),
      baseline: dimensionOnly(51),
    };
    const resultByDimension = summariseProbe([perDimension, perDimension, perDimension]);
    expect(resultByDimension.verdict).toBe('style_sensitive');
    expect(resultByDimension.dimensions.sentence_structure?.meanDelta).toBe(-10);
  });
  it('P6 requires three comparable observations per metric for a verdict or sensitivity', () => {
    const noOverall = (value: Scores) => ({ ...value, overall: null });
    const comparable = {
      original: noOverall(score(50)),
      rewritten: noOverall(score(90)),
      baseline: noOverall(score(50)),
    };
    const missing = { original: score(50, false), rewritten: score(90), baseline: score(50) };
    expect(summariseProbe([comparable, comparable, missing]).verdict).toBe('insufficient');
    const other = (value: number) => ({
      ...noOverall(score(value)),
      dimensions: score(value).dimensions.map((dimension) => ({
        ...dimension,
        id: 'verb_word_choice' as const,
      })),
    });
    const stable = { original: other(50), rewritten: other(50), baseline: other(50) };
    expect(summariseProbe([comparable, comparable, stable, stable, stable]).verdict).toBe('stable');
  });
});

describe('P6 style-only rewrites may reorder wording', () => {
  it('keeps a reordered sentence whose negations and numbers are unchanged', () => {
    const original =
      'Our attack differs fundamentally in that it requires no tuning, no targeting, and no hidden text. See § 4 for details.';
    const rewritten =
      'Fundamentally, our attack differs in that it requires no tuning, no targeting, and no hidden text. Details are in § 4.';
    expect(validateProbe(original, rewritten)).toMatchObject({ valid: true, reasons: [] });
  });
  it('still discards a dropped negation, a changed value and a changed unit', () => {
    expect(validateProbe('It did not improve.', 'It improved.').valid).toBe(false);
    expect(validateProbe('Growth rose by 12%.', 'Growth rose by 13%.').valid).toBe(false);
    expect(validateProbe('It took 5 days to finish.', 'It took 5 weeks to finish.').valid).toBe(false);
    expect(validateProbe('Dose was 10 mg/L here.', 'Here dose was 10 g/L.').valid).toBe(false);
  });
  it('the Revise checks stay position-sensitive by default', () => {
    const original = 'It has no effect, and it works.';
    const reordered = 'It works, and it has no effect.';
    expect(meaningChecks(original, reordered, []).find((c) => c.id === 'negation_preserved')?.status).toBe(
      'fail',
    );
    expect(
      meaningChecks(original, reordered, [], { orderInsensitive: true }).find(
        (c) => c.id === 'negation_preserved',
      )?.status,
    ).toBe('pass');
  });
});

describe('P6 verdict needs more than one rubric level on one paragraph', () => {
  const scores = (score: number) =>
    ({
      overall: null,
      dimensions: [{ id: 'verb_word_choice', applicable: true, score }],
    }) as unknown as NonNullable<ProbeItem['original']>;
  const item = (original: number, rewritten: number): ProbeItem => ({
    original: scores(original),
    rewritten: scores(rewritten),
    baseline: scores(original),
  });
  it('one level on one of three paragraphs stays stable', () => {
    expect(summariseProbe([item(75, 50), item(75, 75), item(75, 75)]).verdict).toBe('stable');
  });
  it('one level on two of three paragraphs is style sensitive', () => {
    expect(summariseProbe([item(75, 50), item(75, 50), item(75, 75)]).verdict).toBe('style_sensitive');
  });
});
