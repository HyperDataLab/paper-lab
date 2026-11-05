/// <reference types="node" />
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RawSentenceSyntax } from '../prompts/sentenceSyntax';
import { SentenceAnnotationSchema, validateAnalysisSpans, type TextAnalysis } from '../schemas';
import { analyzeText, sliceCp } from '../text';
import {
  buildSentenceAnnotations,
  classifyGap,
  computeSentenceMetrics,
  isDeepClause,
  validateSentenceSyntax,
  validateSyntaxOutput,
} from '.';

const PRD =
  'The performance of the proposed model, after extensive testing across multiple datasets, was dramatically improved. These improvements are very significant. Several experiments were conducted to evaluate the system.';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));

function raw(sentenceId: string, partial: Partial<RawSentenceSyntax> = {}): RawSentenceSyntax {
  return {
    sentenceId,
    subject: null,
    subjectHead: null,
    mainVerb: null,
    mainVerbHead: null,
    topic: null,
    action: null,
    stress: null,
    voice: null,
    clauseCount: null,
    maxClauseDepth: null,
    confidence: 0.9,
    ...partial,
  };
}
/** Global token index of the n-th occurrence of `word`. */
function at(text: TextAnalysis, word: string, nth = 0): number {
  const hits = text.tokens.filter((token) => token.text === word);
  const hit = hits[nth];
  if (!hit) throw new Error(`token ${word} not found`);
  return hit.index;
}
function prdSentence1(text: TextAnalysis): RawSentenceSyntax {
  const was = at(text, 'was');
  return raw('s1', {
    subject: { start: 0, end: at(text, 'model') + 1 },
    subjectHead: at(text, 'performance'),
    mainVerb: { start: was, end: at(text, 'improved') + 1 },
    mainVerbHead: at(text, 'improved'),
    topic: { start: 0, end: at(text, 'model') + 1 },
    action: { start: was, end: at(text, 'improved') + 1 },
    stress: { start: at(text, 'dramatically'), end: at(text, 'improved') + 1 },
    voice: 'passive',
    clauseCount: 1,
    maxClauseDepth: 0,
  });
}

describe('subject–verb distance', () => {
  it('AC-02 PRD example: 6 tokens and intervening span [39, 87), reproducible', async () => {
    const text = await analyzeText(PRD);
    const sentence = text.sentences[0]!;
    const syntax = validateSentenceSyntax(prdSentence1(text), sentence);
    const first = computeSentenceMetrics(syntax, sentence, text.tokens);
    expect(first.subjectVerbDistanceTokens).toBe(6);
    expect(first.interveningSpan).toEqual({ start: 39, end: 87 });
    expect(sliceCp(PRD, 39, 87)).toBe('after extensive testing across multiple datasets');
    expect(first.subjectSpan).toEqual({ start: 0, end: 37 });
    expect(computeSentenceMetrics(syntax, sentence, text.tokens)).toEqual(first);
  });

  it('EV-03 verb before subject is atypical and returns null', async () => {
    const text = await analyzeText('Here comes the result.');
    const s = text.sentences[0]!;
    const syntax = validateSentenceSyntax(
      raw('s1', { subject: { start: 2, end: 4 }, mainVerb: { start: 1, end: 2 } }),
      s,
    );
    const m = computeSentenceMetrics(syntax, s, text.tokens);
    expect(m.subjectVerbDistanceTokens).toBeNull();
    expect(m.interveningSpan).toBeNull();
    expect(m.reasons).toContain('subjectVerbDistance: atypical order');
  });

  it('EV-03 overlapping subject and verb return null', async () => {
    const text = await analyzeText('Cells grow fast.');
    const s = text.sentences[0]!;
    const syntax = validateSentenceSyntax(
      raw('s1', { subject: { start: 0, end: 2 }, mainVerb: { start: 1, end: 2 } }),
      s,
    );
    const m = computeSentenceMetrics(syntax, s, text.tokens);
    expect(m.subjectVerbDistanceTokens).toBeNull();
    expect(m.reasons).toContain('subjectVerbDistance: overlap');
  });

  it('EV-03 adjacent subject and verb give 0 and no intervening span', async () => {
    const text = await analyzeText('Cells grow fast.');
    const s = text.sentences[0]!;
    const syntax = validateSentenceSyntax(
      raw('s1', { subject: { start: 0, end: 1 }, mainVerb: { start: 1, end: 2 } }),
      s,
    );
    const m = computeSentenceMetrics(syntax, s, text.tokens);
    expect(m.subjectVerbDistanceTokens).toBe(0);
    expect(m.interveningSpan).toBeNull();
  });
});

describe('validation of model candidates', () => {
  it('EV-03 out-of-range, empty and head-outside ranges become null with reasons', async () => {
    const text = await analyzeText('Cells grow fast. Roots spread.');
    const s1 = text.sentences[0]!;
    const syntax = validateSentenceSyntax(
      raw('s1', {
        subject: { start: 0, end: 9 },
        mainVerb: { start: 1, end: 1 },
        topic: { start: 0, end: 1 },
        subjectHead: 0,
        mainVerbHead: 3,
        stress: { start: 1, end: 3 },
        confidence: 1.4,
        clauseCount: -1,
      }),
      s1,
    );
    expect(syntax.subject).toBeNull();
    expect(syntax.mainVerb).toBeNull();
    expect(syntax.subjectHead).toBeNull();
    expect(syntax.mainVerbHead).toBeNull();
    expect(syntax.topic).toEqual({ start: 0, end: 1 });
    expect(syntax.confidence).toBeNull();
    expect(syntax.clauseCount).toBeNull();
    expect(syntax.unresolved).toEqual(
      expect.arrayContaining([
        'subject: out of sentence range',
        'mainVerb: empty range',
        'subjectHead: outside its range',
        'mainVerbHead: outside its range',
        'confidence: outside 0..1',
      ]),
    );
  });

  it('EV-03 missing sentence → all null; unknown id dropped; first duplicate wins', async () => {
    const text = await analyzeText('Cells grow fast. Roots spread.');
    const out = validateSyntaxOutput(
      [raw('s1', { voice: 'active' }), raw('s1', { voice: 'passive' }), raw('s9', { voice: 'active' })],
      text,
    );
    expect(out.map((entry) => entry.sentenceId)).toEqual(['s1', 's2']);
    expect(out[0]?.voice).toBe('active');
    expect(out[1]?.unresolved).toEqual(['no model output']);
    expect(out[1]?.subject).toBeNull();
  });
});

describe('Topic / Action / Stress', () => {
  it('EV-02 spans and positional metrics come from token offsets', async () => {
    const text = await analyzeText('In 2020, soil carbon declined sharply. It recovered later.');
    const s1 = text.sentences[0]!;
    const soil = at(text, 'soil');
    const syntax = validateSentenceSyntax(
      raw('s1', {
        topic: { start: soil, end: soil + 2 },
        stress: { start: at(text, 'sharply'), end: at(text, 'sharply') + 1 },
      }),
      s1,
    );
    const m = computeSentenceMetrics(syntax, s1, text.tokens);
    expect(m.topicSpan && sliceCp(text.sourceText, m.topicSpan.start, m.topicSpan.end)).toBe('soil carbon');
    expect(m.preTopicTokens).toBe(2);
    expect(m.topicPositionRatio).toBe(Math.round((9 / 38) * 1000) / 1000);
    expect(m.stressEndDistance).toBe(0);
    const s2 = text.sentences[1]!;
    const m2 = computeSentenceMetrics(validateSentenceSyntax(raw('s2'), s2), s2, text.tokens);
    expect(m2.preTopicTokens).toBeNull();
    expect(m2.topicPositionRatio).toBeNull();
    expect(m2.stressEndDistance).toBeNull();
  });
});

describe('heuristics are labels only', () => {
  it('AC-09 passive voice is recorded descriptively and no issue is created', async () => {
    const text = await analyzeText(PRD);
    const annotations = buildSentenceAnnotations(text, validateSyntaxOutput([prdSentence1(text)], text));
    expect(annotations[0]?.voice).toBe('passive');
    expect(annotations[0]?.subjectVerbDistanceTokens).toBe(6);
    expect(annotations).toHaveLength(3);
    expect(annotations[1]?.unresolved).toEqual(['no model output']);
    expect('issues' in (annotations[0] ?? {})).toBe(false);
  });

  it('classifyGap and isDeepClause thresholds (product heuristics)', () => {
    expect(classifyGap(null)).toBeNull();
    expect(classifyGap(7)).toBe('none');
    expect(classifyGap(8)).toBe('review');
    expect(classifyGap(15)).toBe('high');
    expect(isDeepClause(3)).toBe(true);
    expect(isDeepClause(2)).toBe(false);
    expect(isDeepClause(null)).toBe(false);
  });
});

describe('schema compatibility', () => {
  it('an S3-era annotation without S5 fields still parses with defaults', () => {
    const parsed = SentenceAnnotationSchema.parse({
      sentenceId: 's1',
      topicSpan: null,
      actionSpan: null,
      stressSpan: null,
      role: null,
      subjectVerbDistanceTokens: null,
      parseConfidence: null,
    });
    expect(parsed.subjectSpan).toBeNull();
    expect(parsed.unresolved).toEqual([]);
  });

  it('AC-04 invalid S5 spans are suppressed by validateAnalysisSpans', async () => {
    const text = await analyzeText(PRD);
    const [annotation] = buildSentenceAnnotations(text, validateSyntaxOutput([prdSentence1(text)], text));
    const now = new Date().toISOString();
    const { valid, suppressed } = validateAnalysisSpans({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      text,
      context: { before: null, after: null, audience: null },
      contextLimited: true,
      versions: { rubric: null, prompt: null, model: null, syntaxProvider: null },
      sentenceAnnotations: [{ ...annotation!, interveningSpan: { start: 0, end: 9999 } }],
      issues: [],
      parentAnalysisId: null,
    });
    expect(valid.sentenceAnnotations[0]?.interveningSpan).toBeNull();
    expect(valid.sentenceAnnotations[0]?.subjectSpan).toEqual({ start: 0, end: 37 });
    expect(suppressed.map((entry) => entry.path)).toContain('sentenceAnnotations.0.interveningSpan');
  });
});
