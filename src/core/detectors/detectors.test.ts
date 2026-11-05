/// <reference types="node" />
import { webcrypto } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';
import { CandidateJudgeOutputSchema } from '../prompts';
import { SentenceAnnotationSchema } from '../schemas';
import { analyzeText, sliceCp } from '../text';
import { applyJudgement, detectCandidates, detectStructural } from '.';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));
const annotation = (extra: Record<string, unknown> = {}) =>
  SentenceAnnotationSchema.parse({
    sentenceId: 's1',
    topicSpan: null,
    actionSpan: null,
    stressSpan: null,
    role: null,
    subjectVerbDistanceTokens: null,
    parseConfidence: null,
    ...extra,
  });
const spanText = (source: string, span: { start: number; end: number }) =>
  sliceCp(source, span.start, span.end);
it('AC-03 detects the PRD candidates with exact spans and stable ids', async () => {
  const text = await analyzeText(
    'The performance of the proposed model, after extensive testing across multiple datasets, was dramatically improved. These improvements are very significant. Several experiments were conducted to evaluate the system.',
  );
  const conducted = text.tokens.find((t) => t.text === 'conducted');
  const were = text.tokens.find((t) => t.text === 'were');
  expect(conducted && were).toBeTruthy();
  const annotations = [
    annotation({ sentenceId: 's3', verbSpan: { start: were?.start, end: conducted?.end } }),
    annotation({ subjectVerbDistanceTokens: 6, interveningSpan: { start: 39, end: 87 } }),
  ];
  const candidates = detectCandidates(text, annotations);
  expect(candidates.map((i) => [i.type, spanText(text.sourceText, i.spans[0]!)])).toEqual([
    ['UNSUPPORTED_INTENSIFIER', 'dramatically'],
    ['WEAK_MODIFIER', 'very'],
    ['FUZZY_VERB', 'were conducted'],
  ]);
  expect(detectCandidates(text, annotations)).toEqual(candidates);
  expect(spanText(text.sourceText, detectCandidates(text, null)[2]!.spans[0]!)).toBe('conducted');
});
it('EV-03 gap and clause depth use review thresholds', async () => {
  const text = await analyzeText('Cells and roots grow.');
  const base = { interveningSpan: { start: 6, end: 15 } };
  expect(detectStructural(text, [annotation({ ...base, subjectVerbDistanceTokens: 9 })])[0]?.severity).toBe(
    'minor',
  );
  expect(
    detectStructural(text, [annotation({ ...base, subjectVerbDistanceTokens: 15, maxClauseDepth: 3 })]).map(
      (i) => [i.type, i.severity],
    ),
  ).toEqual([
    ['SUBJECT_VERB_GAP', 'moderate'],
    ['CLAUSE_DEPTH', 'minor'],
  ]);
  expect(detectStructural(text, [annotation()])).toEqual([]);
});
it('EV-05 protects qualifiers and numeric modifiers', async () => {
  const text = await analyzeText(
    'Statistically significant results were preliminary and significantly different, highly 3-fold.',
  );
  expect(detectCandidates(text, null)).toEqual([]);
});
it('EV-04 nominalizations need an action context and exclude common terms', async () => {
  const text = await analyzeText('They performed an evaluation of information and population.');
  expect(
    detectCandidates(text, null)
      .filter((i) => i.type === 'NOMINALIZATION')
      .map((i) => spanText(text.sourceText, i.spans[0]!)),
  ).toEqual(['evaluation']);
});
it('EV-04 excludes auxiliary have and do while retaining main verbs and annotated verb groups', async () => {
  const text = await analyzeText(
    'We have not observed it. It did not change. They have been shown results. It does the analysis.',
  );
  const shown = text.tokens.find((token) => token.text === 'shown')!;
  const have = text.tokens.find((token) => token.text === 'have' && token.start > shown.start - 15)!;
  const annotations = [
    annotation({
      sentenceId: 's3',
      verbSpan: { start: have.start, end: shown.end },
      verbHeadTokenIndex: shown.index,
    }),
  ];
  expect(
    detectCandidates(text, annotations)
      .filter((item) => item.type === 'FUZZY_VERB')
      .map((item) => spanText(text.sourceText, item.spans[0]!)),
  ).toEqual(['have been shown', 'does']);
  expect(
    detectCandidates(text, null)
      .filter((item) => item.type === 'FUZZY_VERB')
      .map((item) => spanText(text.sourceText, item.spans[0]!)),
  ).toEqual(['shown', 'does']);
  const annotated = await analyzeText('They have results.');
  const auxiliary = annotated.tokens[1]!;
  expect(detectCandidates(annotated, [annotation({ verbSpan: auxiliary, verbHeadTokenIndex: 2 })])).toEqual(
    [],
  );
});
it('detector explanations and candidate metrics are specific to each finding type', async () => {
  const text = await analyzeText(
    'They performed an evaluation of very dramatically changing results in order to test. It should be noted that results vary.',
  );
  const candidates = detectCandidates(text, [
    annotation({ subjectVerbDistanceTokens: 9, interveningSpan: { start: 5, end: 14 }, maxClauseDepth: 3 }),
  ]);
  expect(new Set(candidates.map((item) => item.type)).size).toBe(8);
  expect(new Set(candidates.map((item) => item.why)).size).toBe(8);
  for (const item of candidates.filter((item) => item.category === 'word')) {
    expect(item.metric).toEqual({
      name: `${item.type.toLowerCase()}_candidates`,
      value: 1,
      unit: 'candidate',
    });
  }
  expect(candidates.find((item) => item.type === 'UNSUPPORTED_INTENSIFIER')?.suggestedFix).toContain(
    'dữ liệu của bạn',
  );
});
it('EV-06 detects wordy phrases and never matches across sentences', async () => {
  const text = await analyzeText(
    'In order to test, it is important to note that results vary. In order. To test.',
  );
  const matches = detectCandidates(text, null).filter(
    (i) => i.type === 'REDUNDANT_PHRASE' || i.type === 'METADISCOURSE',
  );
  expect(matches.map((i) => i.suggestedFix)).toEqual(['Thay bằng "to"', 'Có thể bỏ cụm này']);
});
it('AC-09 passive voice only creates an issue through judgement', async () => {
  const text = await analyzeText('Cells were measured.');
  const annotations = [annotation({ voice: 'passive', verbSpan: { start: 6, end: 19 } })];
  expect(detectCandidates(text, annotations)).toEqual([]);
  const output = {
    judgements: [],
    passive: [
      { sentenceId: 's1', problematic: true, confidence: 0.8, why: 'Cần xem xét.', suggestedFix: null },
    ],
  };
  expect(applyJudgement([], output, text, annotations)[0]).toMatchObject({
    type: 'PASSIVE_PROBLEMATIC',
    status: 'confirmed_by_model',
  });
  expect(applyJudgement([], output, text, [annotation()])).toEqual([]);
});
it('judgements keep original spans, apply verdicts, ignore unknown and duplicate ids and reject critical', async () => {
  const text = await analyzeText('Very dramatically improved.');
  const candidates = detectCandidates(text, null);
  const first = candidates[0]!;
  const second = candidates[1]!;
  const entry = {
    id: first.id,
    verdict: 'problematic' as const,
    severity: null,
    confidence: 0.8,
    why: '',
    suggestedFix: null,
  };
  const result = applyJudgement(
    candidates,
    {
      judgements: [
        entry,
        { ...entry, verdict: 'acceptable' },
        { ...entry, id: 'unknown' },
        { ...entry, id: second.id, verdict: 'acceptable', why: 'Ổn' },
      ],
      passive: [],
    },
    text,
    null,
  );
  expect(result[0]).toMatchObject({
    id: first.id,
    spans: first.spans,
    why: first.why,
    suggestedFix: first.suggestedFix,
    status: 'confirmed_by_model',
  });
  expect(result[1]).toMatchObject({
    severity: 'info',
    findingKind: 'stylistic_suggestion',
    why: 'Ổn',
    suggestedFix: null,
  });
  expect(
    applyJudgement(
      candidates,
      { judgements: [{ ...entry, id: second.id, verdict: 'acceptable', why: ' ' }], passive: [] },
      text,
      null,
    )[1],
  ).toMatchObject({ why: second.why, suggestedFix: null });
  expect(
    CandidateJudgeOutputSchema.safeParse({ judgements: [{ ...entry, severity: 'critical' }], passive: [] })
      .success,
  ).toBe(false);
  expect(
    applyJudgement(candidates, { judgements: [{ ...entry, verdict: 'uncertain' }], passive: [] }, text, null),
  ).toEqual(candidates);
});
