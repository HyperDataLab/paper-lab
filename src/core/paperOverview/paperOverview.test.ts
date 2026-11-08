import { describe, expect, it } from 'vitest';
import { AnalysisSchema, type Paper } from '../schemas';
import { analyzeText } from '../text/analyzeText';
import { PROMPT_VERSIONS, buildParagraphTransitionPrompt } from '../prompts';
import {
  aggregatePaper,
  transitionFindings,
  transitionPairs,
  transitionStatus,
  validateTransitions,
} from './index';

const at = '2026-01-01T00:00:00.000Z';
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: '',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
  sections: ['a', 'b'].map((id) => ({ id, heading: '', role: 'methods', level: 1, pageStart: null })),
  paragraphs: ['a', 'a', 'a', 'b'].map((sectionId, order) => ({
    id: `p${order}`,
    sectionId,
    order,
    text: `Sentence ${order}.`,
    pageStart: null,
    kind: 'body',
    textHash: '',
  })),
};
async function analyses() {
  return Promise.all(
    paper.paragraphs.map(async (p, i) => {
      const text = await analyzeText(p.text);
      return AnalysisSchema.parse({
        schemaVersion: 1,
        id: `00000000-0000-4000-8000-00000000000${i + 2}`,
        createdAt: at,
        updatedAt: at,
        text,
        context: { before: null, after: null, audience: null },
        contextLimited: true,
        versions: { rubric: 'rubric', prompt: 'prompt', model: null, syntaxProvider: null },
        sentenceAnnotations: [
          {
            sentenceId: 's1',
            topicSpan: { start: 0, end: 8 },
            actionSpan: null,
            stressSpan: { start: 0, end: 8 },
            subjectVerbDistanceTokens: null,
            parseConfidence: null,
          },
        ],
        issues: [
          {
            id: 'i',
            type: 'FUZZY_VERB',
            category: 'word',
            findingKind: 'review_candidate',
            status: 'candidate',
            severity: 'minor',
            spans: [{ start: 0, end: 8, role: 'x' }],
            sentenceIds: ['s1'],
            metric: { name: '', value: null, unit: null },
            why: '',
            suggestedFix: null,
            sourcePrinciple: '',
            confidence: 1,
          },
        ],
        parentAnalysisId: null,
        origin: { kind: 'paper', paperId: paper.id, paragraphId: p.id },
      });
    }),
  );
}
describe('P3 paper overview', () => {
  it('counts coverage, open issues, recurring quotes and versions', async () => {
    const input = await analyses();
    const second = input[1];
    if (!second) throw new Error('missing analysis');
    second.issues[0]!.status = 'dismissed_by_human';
    const overview = aggregatePaper(paper, input.slice(0, 3));
    expect(overview.coverage).toBe(0.75);
    expect(overview.sections[0]).toMatchObject({ analysed: 3, coverage: 1, issuesByType: { FUZZY_VERB: 2 } });
    expect(overview.scores.sentence_structure).toBeNull();
    expect(overview.recurringIssues).toEqual([]);
    const full = aggregatePaper(paper, input);
    expect(full.recurringIssues[0]).toMatchObject({
      type: 'FUZZY_VERB',
      count: 3,
      sectionIds: ['a', 'b'],
      examples: ['Sentence'],
    });
    expect(full.generatedFrom[0]).toMatchObject({
      updatedAt: at,
      promptVersions: ['prompt'],
      rubricVersions: ['rubric'],
    });
  });
  it('pairs only annotated consecutive body paragraphs in a section and validates model output', async () => {
    const input = await analyses();
    const pairs = transitionPairs(paper, input);
    expect(pairs.map((p) => p.pairId)).toEqual(['p0->p1', 'p1->p2']);
    expect(transitionPairs(paper, input.slice(1)).map((p) => p.pairId)).toEqual(['p1->p2']);
    expect(PROMPT_VERSIONS.paragraphTransition).toBe('para-flow-1');
    expect(() => buildParagraphTransitionPrompt(Array(13).fill(pairs[0]))).toThrow();
    const judgements = validateTransitions(
      {
        pairs: [
          {
            pairId: 'unknown',
            continuity: 'shift',
            discourseRelation: 'none',
            linked: false,
            confidence: 1,
            rationale: '',
          },
          {
            pairId: 'p0->p1',
            continuity: 'shift',
            discourseRelation: 'other',
            linked: false,
            confidence: 0.8,
            rationale: '',
          },
        ],
      },
      pairs,
    );
    expect(judgements[0]).toMatchObject({ discourseRelation: 'none', measured: true });
    expect(judgements[1]).toMatchObject({ measured: false });
    const findings = transitionFindings(pairs, judgements);
    expect(findings[0]).toMatchObject({
      type: 'FLOW_BREAK_CANDIDATE',
      from: { paragraphId: 'p0' },
      to: { paragraphId: 'p1' },
    });
    const old = findings.map((f) => ({ ...f, status: 'dismissed_by_human' as const }));
    expect(transitionFindings(pairs, judgements, old)[0]?.status).toBe('dismissed_by_human');
  });
  it('P3 computes interpolated quartiles for applicable scores', async () => {
    const input = await analyses();
    for (const [i, analysis] of input.entries()) {
      analysis.scores = {
        rubricVersion: 'r',
        dimensions: [
          {
            id: 'sentence_structure',
            label: '',
            weight: 1,
            applicable: true,
            notAssessableReason: null,
            rubric: 1,
            score: (i + 1) * 20,
            descriptor: null,
            confidence: 1,
            evidence: { issueIds: [], sentenceIds: [] },
            rationale: null,
          },
        ],
        overall: null,
        overallSuppressedReason: null,
        coverage: { applicable: 1, total: 5, value: 0.2 },
        confidence: 1,
        contextLimited: true,
        issueSnapshot: '',
      };
    }
    expect(aggregatePaper(paper, input).scores.sentence_structure).toEqual({
      n: 4,
      min: 20,
      q1: 35,
      median: 50,
      q3: 65,
      max: 80,
    });
    expect(aggregatePaper(paper, input.slice(0, 3)).scores.sentence_structure).toEqual({
      n: 3,
      min: 20,
      q1: 30,
      median: 40,
      q3: 50,
      max: 60,
    });
  });
  it('P3 reports unavailable pairs and staleness using each judgement snapshot', async () => {
    const input = await analyses();
    const pairs = transitionPairs(paper, input);
    const judgements = validateTransitions(
      {
        pairs: pairs.map((p) => ({
          pairId: p.pairId,
          continuity: 'derived',
          discourseRelation: 'example',
          linked: true,
          confidence: 1,
          rationale: '',
        })),
      },
      pairs,
    );
    const stored = {
      pairs,
      judgements,
      findings: [],
      model: 'm',
      promptVersion: 'para-flow-1',
      updatedAt: at,
    };
    expect(transitionStatus(paper, input, stored).stale).toBe(false);
    const first = input[0];
    if (!first) throw new Error('missing analysis');
    first.updatedAt = '2026-02-01T00:00:00.000Z';
    expect(transitionStatus(paper, input, stored).judgements.map((j) => [j.available, j.stale])).toEqual([
      [true, true],
      [true, false],
    ]);
    first.sentenceAnnotations = [];
    expect(transitionStatus(paper, input, stored).judgements[0]).toMatchObject({
      available: false,
      stale: true,
    });
    const removed = { ...paper, paragraphs: paper.paragraphs.filter((p) => p.id !== 'p0') };
    expect(transitionStatus(removed, input, stored).judgements[0]).toMatchObject({
      available: false,
      stale: true,
    });
  });
});
