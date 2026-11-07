import { expect, it } from 'vitest';
import { AnalysisSchema, JsonReportSchema, type AuditEvent } from '../schemas';
import { segmentSentences } from '../text/segment';
import { tokenize } from '../text/tokenize';
import { buildAnalysisReport, compareAnalyses, toJsonReport } from './index';

const id = '00000000-0000-4000-8000-000000000001';
const at = '2025-01-01T00:00:00.000Z';
function fixture(text: string, quote: string, score: number) {
  const tokens = tokenize(text);
  const start = Array.from(text.slice(0, text.indexOf(quote))).length;
  return AnalysisSchema.parse({
    schemaVersion: 1,
    id,
    createdAt: at,
    updatedAt: at,
    text: {
      schemaVersion: 1,
      sourceText: text,
      sourceHash: `sha256:${'a'.repeat(64)}`,
      offsetUnit: 'unicode_codepoint',
      tokenizerVersion: 'tok',
      segmenterVersion: 'seg',
      tokens,
      sentences: segmentSentences(text, tokens),
    },
    context: { before: null, after: null, audience: null },
    contextLimited: true,
    versions: {
      rubric: 'rubric',
      prompt: 'prompt',
      model: 'model',
      syntaxProvider: 'parser',
      detectors: 'rules',
      judgePrompt: 'judge',
      structurePrompt: 'structure',
      structureModel: 'structure-model',
      scoringPrompt: 'score-prompt',
      scoringModel: 'score-model',
    },
    sentenceAnnotations: [],
    paragraphMetrics: {
      sentence_role_coverage: { numerator: score, denominator: 100, value: score / 100 },
      off_topic_sentence_count: { numerator: 0, denominator: 1, value: 0 },
      stress_to_next_topic_alignment: { numerator: 0, denominator: 0, value: null },
      unexplained_topic_shift_count: { numerator: 0, denominator: 0, value: null },
      discourse_relation_coverage: { numerator: 0, denominator: 0, value: null },
      topic_continuity_pattern: Object.fromEntries(
        ['stress_to_topic', 'topic_to_topic', 'derived', 'shift'].map((key) => [
          key,
          { numerator: 0, denominator: 0, value: null },
        ]),
      ),
      central_point_identifiability: { numerator: 0, denominator: 4, value: 0 },
    },
    scores: {
      rubricVersion: 'rubric',
      dimensions: [
        {
          id: 'sentence_structure',
          label: 'Sentence',
          weight: 1,
          applicable: true,
          notAssessableReason: null,
          rubric: 2,
          score,
          descriptor: 'mixed',
          confidence: 0.5,
          evidence: { issueIds: ['i'], sentenceIds: ['s1'] },
          rationale: null,
        },
      ],
      overall: null,
      overallSuppressedReason: 'insufficient',
      coverage: { applicable: 1, total: 5, value: 0.2 },
      confidence: 0.5,
      contextLimited: true,
      issueSnapshot: 'snapshot',
    },
    issues: [
      {
        id: 'i',
        type: 'WEAK_MODIFIER',
        category: 'word',
        findingKind: 'review_candidate',
        status: 'confirmed_by_human',
        severity: 'minor',
        spans: [{ start, end: start + Array.from(quote).length, role: 'modifier' }],
        sentenceIds: ['s1'],
        metric: { name: 'modifier', value: null, unit: null },
        why: 'Review',
        suggestedFix: null,
        sourcePrinciple: 'Ch. 16',
        confidence: 0.5,
      },
    ],
    parentAnalysisId: null,
  });
}
const audit: AuditEvent = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000002',
  analysisId: id,
  issueId: 'i',
  at,
  actor: 'human',
  action: 'confirm',
  before: null,
  after: null,
  note: 'Reviewed',
};
const options = { audit: [audit], revisions: [], generation: null, parent: null };

it('EV-12 includes versions, scoring context, decisions and limits in stable schema-valid JSON', () => {
  const analysis = fixture('😀 very large.', 'very', 50);
  const report = buildAnalysisReport(analysis, options);
  expect(report.analysis.versions).toEqual(analysis.versions);
  expect(report.analysis.text).toMatchObject({
    tokenizerVersion: 'tok',
    segmenterVersion: 'seg',
    sourceHash: analysis.text.sourceHash,
  });
  expect(report.analysis.scores).toMatchObject({
    rubricVersion: 'rubric',
    coverage: { value: 0.2 },
    confidence: 0.5,
    overallSuppressedReason: 'insufficient',
  });
  expect(report.issues.word[0]).toMatchObject({
    status: 'confirmed_by_human',
    spans: [{ quote: 'very', start: 2, end: 6 }],
    decisions: [audit],
  });
  expect(report.limits).toHaveLength(3);
  const json = toJsonReport(report);
  const parsed: unknown = JSON.parse(json);
  expect(JsonReportSchema.safeParse(parsed).success).toBe(true);
  expect(toJsonReport(report)).toBe(json);
  expect(Object.keys(JSON.parse(json) as object)).toMatchInlineSnapshot(`
    [
      "format",
      "formatVersion",
      "report",
    ]
  `);
  expect(Object.keys((JSON.parse(json) as { report: object }).report)).toMatchInlineSnapshot(`
    [
      "analysis",
      "audit",
      "generation",
      "issues",
      "limits",
      "parent",
      "revisions",
    ]
  `);
});

it('AC-08 compares source and revision with deltas, issues, diff and meaning checks', () => {
  const a = fixture('Results may be very large.', 'very', 50);
  const b = fixture('Results are quite large.', 'quite', 75);
  const result = compareAnalyses(a, b);
  expect(result.issues?.resolved).toHaveLength(1);
  expect(result.issues?.new).toHaveLength(1);
  expect(result.issues?.persisting).toHaveLength(0);
  expect(result.metricDeltas.find((item) => item.name === 'sentence_role_coverage')).toMatchObject({
    before: { value: 0.5, denominator: 100 },
    after: { value: 0.75, denominator: 100 },
    delta: 0.25,
  });
  expect(result.scoreDeltas[0]).toMatchObject({ before: 50, after: 75, delta: 25 });
  expect(result.diff.some((hunk) => hunk.kind !== 'equal')).toBe(true);
  expect(result.checks.find((check) => check.id === 'hedging_preserved')?.status).toBe('warn');
  expect(compareAnalyses(a, a).issues?.persisting).toHaveLength(1);
});

it('AC-08 distinguishes missing evaluation from an evaluated analysis with no issues', () => {
  const a = fixture('Very large.', 'Very', 50);
  const evaluatedEmpty = { ...a, issues: [] };
  const unevaluated = { ...evaluatedEmpty, versions: { ...a.versions, detectors: null } };
  expect(compareAnalyses(a, unevaluated).issues).toBeNull();
  expect(compareAnalyses(unevaluated, a).issues).toBeNull();
  expect(compareAnalyses(a, evaluatedEmpty).issues?.resolved).toHaveLength(1);
});

it('AC-08 matches repeated issue quotations one-to-one', () => {
  const a = fixture('very very large.', 'very', 50);
  const issue = a.issues[0];
  if (!issue) throw new Error('Missing issue');
  const twice = {
    ...a,
    issues: [issue, { ...issue, id: 'second', spans: [{ start: 5, end: 9, role: 'modifier' }] }],
  };
  expect(compareAnalyses(twice, a).issues).toMatchObject({
    resolved: [{ id: 'second' }],
    persisting: [{ id: 'i' }],
    new: [],
  });
  expect(compareAnalyses(a, twice).issues).toMatchObject({
    resolved: [],
    persisting: [{ id: 'i' }],
    new: [{ id: 'second' }],
  });
});

it('AC-12 report and comparison do not mutate their inputs', () => {
  const a = fixture('Very large.', 'Very', 50);
  const b = fixture('Quite large.', 'Quite', 75);
  const original = JSON.stringify({ a, b, options });
  const report = buildAnalysisReport(a, options);
  compareAnalyses(a, b);
  report.analysis.text.sourceText = 'changed';
  expect(JSON.stringify({ a, b, options })).toBe(original);
});
