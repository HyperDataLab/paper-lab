/// <reference types="node" />
import { webcrypto } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';
import { ParagraphStructureOutputSchema } from '../prompts/paragraphStructure';
import { SentenceAnnotationSchema, type SentenceAnnotation } from '../schemas/analysis';
import type { TextAnalysis } from '../schemas/text';
import { analyzeText, sliceCp } from '../text';
import { paragraphIssues } from './issues';
import { computeParagraphMetrics } from './metrics';
import { validateParagraphStructure } from './validateParagraphStructure';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));

const PRD =
  'The performance of the proposed model, after extensive testing across multiple datasets, was dramatically improved. These improvements are very significant. Several experiments were conducted to evaluate the system.';

type Raw = ReturnType<typeof ParagraphStructureOutputSchema.parse>;
type Pair = Raw['pairs'][number];

function output(partial: Partial<Raw> & { type?: string } = {}): Raw {
  return ParagraphStructureOutputSchema.parse({
    type: 'TS-D',
    typeScores: { 'TS-D': 0.62, LD: 0.17, LDR: 0.12, OCAR: 0.04, UNKNOWN: 0.05 },
    centralPointSentenceId: 's1',
    identifiability: 3,
    evidence: 'Câu 1 nêu ý chính.',
    roles: [],
    offTopicSentenceIds: [],
    unityRationale: '',
    pairs: [],
    rationale: '',
    ...partial,
  });
}

function cpSpan(needle: string) {
  const start = Array.from(PRD.slice(0, PRD.indexOf(needle))).length;
  return { start, end: start + Array.from(needle).length };
}

async function prdSetup() {
  const text = await analyzeText(PRD);
  const topics: Record<string, string> = {
    s1: 'The performance of the proposed model',
    s2: 'These improvements',
    s3: 'Several experiments',
  };
  const stresses: Record<string, string> = {
    s1: 'was dramatically improved',
    s2: 'very significant',
    s3: 'to evaluate the system',
  };
  const annotations = text.sentences.map((sentence) =>
    SentenceAnnotationSchema.parse({
      sentenceId: sentence.id,
      topicSpan: cpSpan(topics[sentence.id] ?? ''),
      actionSpan: null,
      stressSpan: cpSpan(stresses[sentence.id] ?? ''),
      role: null,
      subjectVerbDistanceTokens: null,
      parseConfidence: null,
    }),
  );
  return { text, annotations };
}

const s1s2: Pair = {
  fromSentenceId: 's1',
  toSentenceId: 's2',
  continuity: 'stress_to_topic',
  discourseRelation: 'restatement',
  linked: true,
  confidence: 0.9,
  rationale: 'Nối tốt.',
};
function s2s3(over: Partial<Pair> = {}): Pair {
  return {
    fromSentenceId: 's2',
    toSentenceId: 's3',
    continuity: 'shift',
    discourseRelation: 'other',
    linked: false,
    confidence: 0.8,
    rationale: 'Chuyển sang thủ tục thí nghiệm.',
    ...over,
  };
}

function run(raw: Raw, text: TextAnalysis, annotations: SentenceAnnotation[]) {
  const result = validateParagraphStructure(raw, text, annotations);
  return {
    ...result,
    metrics: computeParagraphMetrics(result.paragraph, result.roles, result.flowLinks),
    issues: paragraphIssues(result.paragraph, result.flowLinks, text, result.roles),
  };
}

it('AC-05 G1 live-like S2→S3 (shift, other, not linked) is one two-span FLOW_BREAK_CANDIDATE', async () => {
  const { text, annotations } = await prdSetup();
  const result = run(output({ pairs: [s1s2, s2s3()] }), text, annotations);
  expect(result.issues).toHaveLength(1);
  const issue = result.issues[0];
  expect(issue?.type).toBe('FLOW_BREAK_CANDIDATE');
  expect(issue?.category).toBe('flow');
  expect(issue?.status).toBe('candidate');
  expect(issue?.spans.map((s) => [s.role, s.sentenceId, sliceCp(PRD, s.start, s.end)])).toEqual([
    ['stress_from', 's2', 'very significant'],
    ['topic_to', 's3', 'Several experiments'],
  ]);
  expect(issue?.why).toContain('S2');
  expect(issue?.why).toContain('Chuyển sang thủ tục thí nghiệm.');
  expect(issue?.suggestedFix).toContain('không thêm dữ kiện mới');
  expect(issue?.metric).toEqual({ name: 'stress_to_next_topic_alignment', value: 0, unit: 'pair' });
  expect(run(output({ pairs: [s1s2, s2s3()] }), text, annotations).issues[0]?.id).toBe(issue?.id);
  expect(result.metrics.discourse_relation_coverage).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
  expect(result.metrics.unexplained_topic_shift_count).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
  expect(result.metrics.stress_to_next_topic_alignment).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
});

it('G1 shift with relation none: break when unlinked and confident, otherwise an unexplained shift', async () => {
  const { text, annotations } = await prdSetup();
  const none = run(output({ pairs: [s1s2, s2s3({ discourseRelation: 'none' })] }), text, annotations);
  expect(none.issues.map((i) => i.type)).toEqual(['FLOW_BREAK_CANDIDATE']);
  const weak = run(
    output({ pairs: [s1s2, s2s3({ discourseRelation: 'none', confidence: 0.3 })] }),
    text,
    annotations,
  );
  expect(weak.issues.map((i) => [i.type, i.severity])).toEqual([['UNEXPLAINED_TOPIC_SHIFT', 'minor']]);
  const linked = run(
    output({ pairs: [s1s2, s2s3({ discourseRelation: 'none', linked: true })] }),
    text,
    annotations,
  );
  expect(linked.issues.map((i) => i.type)).toEqual(['UNEXPLAINED_TOPIC_SHIFT']);
  expect(linked.issues[0]?.why).toContain('chưa nêu rõ quan hệ');
  for (const relation of ['elaboration', 'cause', 'contrast', 'example', 'sequence', 'restatement'] as const)
    expect(
      run(output({ pairs: [s1s2, s2s3({ discourseRelation: relation })] }), text, annotations).issues,
    ).toEqual([]);
});

it('EV-07 a top type score below 0.4 becomes UNKNOWN; an unknown type string too', async () => {
  const { text, annotations } = await prdSetup();
  const low = output({ typeScores: { 'TS-D': 0.39, LD: 0.2, LDR: 0.1, OCAR: 0.1, UNKNOWN: 0.2 } });
  expect(run(low, text, annotations).paragraph.type).toBe('UNKNOWN');
  expect(run(output({ type: 'XYZ' }), text, annotations).paragraph.type).toBe('UNKNOWN');
  expect(run(output(), text, annotations).paragraph.type).toBe('TS-D');
});

it('EV-08 non-adjacent pairs are dropped, the first duplicate wins, a missing pair is shift/none', async () => {
  const { text, annotations } = await prdSetup();
  const result = run(
    output({
      pairs: [
        { ...s1s2, toSentenceId: 's3' },
        s1s2,
        { ...s1s2, discourseRelation: 'contrast', rationale: 'duplicate' },
      ],
    }),
    text,
    annotations,
  );
  expect(result.flowLinks.map((l) => [l.fromSentenceId, l.toSentenceId])).toEqual([
    ['s1', 's2'],
    ['s2', 's3'],
  ]);
  expect(result.flowLinks[0]?.discourseRelation).toBe('restatement');
  expect(result.flowLinks[1]).toMatchObject({
    continuity: 'shift',
    discourseRelation: 'none',
    linked: false,
    confidence: 0,
    rationale: 'no model output',
  });
  expect(result.issues).toEqual([]);
  const from = result.flowLinks[0]?.fromSpan;
  expect(from && sliceCp(PRD, from.start, from.end)).toBe('was dramatically improved');
});

it('EV-07 a one-sentence paragraph has null pair metrics (denominator 0)', async () => {
  const text = await analyzeText('Only one sentence here.');
  const result = run(output(), text, []);
  expect(result.flowLinks).toEqual([]);
  expect(result.metrics.stress_to_next_topic_alignment).toEqual({
    numerator: 0,
    denominator: 0,
    value: null,
  });
  expect(result.metrics.discourse_relation_coverage.value).toBeNull();
  expect(result.metrics.sentence_role_coverage).toEqual({ numerator: 0, denominator: 1, value: 0 });
  expect(result.metrics.central_point_identifiability.value).toBe(0.75);
});

it('EV-07 weak central point: on the named sentence, else on the first sentence', async () => {
  const { text, annotations } = await prdSetup();
  const named = run(output({ identifiability: 1, centralPointSentenceId: 's2' }), text, annotations);
  const weak = named.issues.find((i) => i.type === 'CENTRAL_POINT_WEAK');
  expect(weak?.severity).toBe('major');
  expect(weak?.sentenceIds).toEqual(['s2']);
  expect(weak?.why).toContain('câu S2');
  const none = run(output({ identifiability: 0, centralPointSentenceId: null }), text, annotations);
  const fallback = none.issues.find((i) => i.type === 'CENTRAL_POINT_WEAK');
  expect(fallback?.sentenceIds).toEqual(['s1']);
  expect(fallback?.why).toContain('chưa có câu nêu ý chính');
  expect(run(output({ identifiability: 2 }), text, annotations).issues).toEqual([]);
});

it('EV-07 off-topic sentences become whole-sentence candidates with the role rationale', async () => {
  const { text, annotations } = await prdSetup();
  const result = run(
    output({
      offTopicSentenceIds: ['s3', 's9', 's3'],
      roles: [{ sentenceId: 's3', role: 'off_topic', confidence: 0.7, rationale: 'Nói về thủ tục.' }],
    }),
    text,
    annotations,
  );
  const off = result.issues.filter((i) => i.type === 'OFF_TOPIC_SENTENCE');
  expect(off).toHaveLength(1);
  expect(off[0]?.spans[0]).toMatchObject({ role: 'sentence', sentenceId: 's3' });
  expect(off[0]?.why).toContain('Nói về thủ tục.');
  expect(result.metrics.off_topic_sentence_count).toEqual({ numerator: 1, denominator: 3, value: 0.333 });
  expect(result.roles.find((r) => r.sentenceId === 's3')?.role).toBe('off_topic');
});
