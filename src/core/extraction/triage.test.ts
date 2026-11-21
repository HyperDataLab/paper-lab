import { describe, expect, it } from 'vitest';
import { prismaCounts, screeningLogRows } from '../corpus/prisma';
import { promoteProject } from '../corpus/topic';
import type { Candidate, ExtractionProject, TriageOutput } from '../schemas';
import { candidateFromWork, decideCandidate } from './deep';
import { newProject } from './project';
import {
  acceptTriage,
  applyTriage,
  borderlineSample,
  bucketOf,
  criteriaOf,
  DEFAULT_THRESHOLDS,
  estimateTriage,
  normalThresholds,
  sortByScore,
  TRIAGE_BATCH,
  triageBatches,
  triageBuckets,
  triagePending,
  triageRow,
} from './triage';

const at = '2026-01-01T00:00:00.000Z';
const make = (i: number, over: Partial<Candidate> = {}): Candidate => ({
  ...(candidateFromWork(
    { id: `https://openalex.org/W${i}`, display_name: `Paper ${i}`, publication_year: 2020 + (i % 5) },
    'q',
  ) as Candidate),
  ...over,
});
const scored = (
  i: number,
  relevance: number,
  matched: string[] = [],
  decision: 'included' | 'excluded' | 'uncertain' = 'included',
) =>
  make(i, {
    suggestion: {
      decision,
      reason: 'r',
      relevance,
      quality: 0.5,
      matched,
      promptVersion: 'screening-triage-1',
    },
  });
const criteria = criteriaOf({ inclusion: ['edge computing', 'latency'], exclusion: ['simulation only'] });
const row = (label: string, over: Partial<TriageOutput['papers'][number]> = {}) => ({
  label,
  relevance: 0.8,
  quality: 0.6,
  decision_suggestion: 'include' as const,
  matched_criteria: ['I1'],
  reason: 'Đúng chủ đề',
  ...over,
});

describe('R1 screening triage', () => {
  it('numbers criteria I1… and E1… and batches 15–20 papers per call', () => {
    expect(criteria.map((item) => item.id)).toEqual(['I1', 'I2', 'E1']);
    expect(TRIAGE_BATCH).toBeGreaterThanOrEqual(15);
    expect(TRIAGE_BATCH).toBeLessThanOrEqual(20);
    const list = Array.from({ length: 40 }, (_, i) => make(i));
    expect(triageBatches(list).map((batch) => batch.length)).toEqual([18, 18, 4]);
    expect(estimateTriage(list)).toMatchObject({ papers: 40, calls: 3 });
    expect(estimateTriage(list).tokens).toBeGreaterThan(0);
  });

  it('shows the model title, year, venue, type, keywords and an abstract cut at about 1200 characters', () => {
    const line = triageRow(
      'P1',
      make(1, { venue: 'IEEE IoT', workType: 'article', keywords: ['edge'], abstract: 'x'.repeat(2000) }),
    );
    expect(line).toContain('[P1] "Paper 1"');
    expect(line).toContain('venue: IEEE IoT');
    expect(line).toContain('type: article');
    expect(line).toContain('keywords: edge');
    expect(line.length).toBeLessThan(1400);
  });

  it('only papers undecided and without scores are pending, so a stopped run resumes where it stopped', () => {
    const list = [
      make(1),
      scored(2, 0.9),
      make(3, { status: 'excluded' }),
      make(4, { suggestion: { decision: 'included', reason: 'old' } }),
    ];
    expect(triagePending(list).map((item) => item.key)).toEqual(['W1', 'W4']);
  });

  it('applies a reply by label: clamps scores, drops unknown criteria and leaves skipped or decided papers', () => {
    const list = [make(1), make(2), make(3), make(4, { status: 'included' })];
    const batch = list.map((item, index) => ({ label: `P${index + 1}`, key: item.key }));
    const next = applyTriage(
      list,
      batch,
      {
        papers: [
          row('[P1]', { relevance: 1.4, quality: -2, matched_criteria: ['i1', 'E1', 'X9'] }),
          row('P3', { relevance: null }),
          row('P4'),
          row('P9'),
        ],
      },
      criteria,
      { model: 'm', promptVersion: 'screening-triage-1' },
    );
    expect(next[0]?.suggestion).toEqual({
      decision: 'included',
      reason: 'Đúng chủ đề',
      relevance: 1,
      quality: 0,
      matched: ['I1', 'E1'],
      model: 'm',
      promptVersion: 'screening-triage-1',
    });
    expect(next[0]?.status).toBe('candidate');
    expect(next[1]?.suggestion).toBeNull();
    expect(next[2]?.suggestion).toBeNull();
    expect(next[3]?.suggestion).toBeNull();
  });

  it('buckets by thresholds, and a matched exclusion criterion always excludes', () => {
    expect(bucketOf(scored(1, 0.7))).toBe('included');
    expect(bucketOf(scored(1, 0.69))).toBe('uncertain');
    expect(bucketOf(scored(1, 0.3))).toBe('uncertain');
    expect(bucketOf(scored(1, 0.29))).toBe('excluded');
    expect(bucketOf(scored(1, 0.95, ['I1', 'E1']))).toBe('excluded');
    expect(bucketOf(make(1))).toBeNull();
    expect(bucketOf(scored(1, 0.6), { include: 0.5, exclude: 0.2 })).toBe('included');
    expect(normalThresholds({ include: 0.4, exclude: 0.6 })).toEqual({ include: 0.4, exclude: 0.4 });
    expect(normalThresholds({ include: Number.NaN, exclude: 2 })).toEqual({ include: 0.7, exclude: 0.7 });
  });

  it('counts each bucket live as the thresholds move, over undecided papers only', () => {
    const list = [
      scored(1, 0.9),
      scored(2, 0.5),
      scored(3, 0.1),
      scored(4, 0.9, ['E1']),
      scored(5, 0.9, [], 'included'),
    ];
    list[4] = { ...list[4]!, status: 'included' };
    const counts = (t = DEFAULT_THRESHOLDS) =>
      Object.fromEntries(Object.entries(triageBuckets(list, t)).map(([key, items]) => [key, items.length]));
    expect(counts()).toEqual({ included: 1, excluded: 2, uncertain: 1 });
    expect(counts({ include: 0.4, exclude: 0.3 })).toEqual({ included: 2, excluded: 2, uncertain: 0 });
  });

  it('samples about five borderline papers nearest a threshold, disagreements first, the same each time', () => {
    const list = [
      scored(1, 0.95),
      scored(2, 0.71),
      scored(3, 0.31, [], 'uncertain'),
      // The model said Loại, the thresholds say Chưa chắc: a disagreement counts as close.
      scored(4, 0.5, [], 'excluded'),
      scored(5, 0.05, [], 'excluded'),
      scored(6, 0.68, [], 'uncertain'),
      scored(7, 0.2, [], 'excluded'),
      make(8),
    ];
    const sample = borderlineSample(list);
    expect(sample).toHaveLength(5);
    expect(sample.slice(0, 3)).toEqual(['W2', 'W3', 'W6']);
    expect(sample).toContain('W4');
    expect(sample).not.toContain('W8');
    expect(borderlineSample(list)).toEqual(sample);
  });

  it('sorts by score with unscored papers last', () => {
    const list = [make(1), scored(2, 0.2), scored(3, 0.9)];
    expect(sortByScore(list, 'relevance-desc').map((item) => item.key)).toEqual(['W3', 'W2', 'W1']);
    expect(sortByScore(list, 'relevance-asc').map((item) => item.key)).toEqual(['W2', 'W3', 'W1']);
    expect(sortByScore(list, 'default')).toBe(list);
  });

  it('accepting a bucket records ai_accepted decisions, and PRISMA counts and the log follow', () => {
    const list = [scored(1, 0.9), scored(2, 0.1), scored(3, 0.95, ['E1']), scored(4, 0.5), scored(5, 0.9)];
    list[4] = { ...list[4]!, status: 'excluded', decidedAt: at };
    const buckets = triageBuckets(list, DEFAULT_THRESHOLDS);
    const excluded = acceptTriage(
      list,
      [...buckets.excluded.map((item) => item.key), 'W1', 'W5'],
      'excluded',
      DEFAULT_THRESHOLDS,
      at,
    );
    // W1 is in Chọn and W5 was decided by a person: neither changes.
    expect(excluded.applied).toBe(2);
    expect(excluded.candidates.map((item) => [item.key, item.status, item.decidedBy])).toEqual([
      ['W1', 'candidate', undefined],
      ['W2', 'excluded', 'ai_accepted'],
      ['W3', 'excluded', 'ai_accepted'],
      ['W4', 'candidate', undefined],
      ['W5', 'excluded', undefined],
    ]);
    const included = acceptTriage(excluded.candidates, ['W1'], 'included', DEFAULT_THRESHOLDS, at);
    // A person reopening or overriding drops the AI mark.
    expect(decideCandidate(included.candidates, 'W2', 'included', at)[1]?.decidedBy).toBe('person');
    expect(decideCandidate(included.candidates, 'W2', 'candidate', at)[1]?.decidedBy).toBeUndefined();

    const project: ExtractionProject = {
      ...newProject({ id: 'p', title: 'Edge', researchQuestion: 'RQ', now: at }),
      deep: { plan: null, rounds: [], candidates: included.candidates, syntheses: [] },
    };
    const corpus = promoteProject(project, 'c', at);
    expect(prismaCounts(corpus)).toMatchObject({
      members: 5,
      recordsScreened: 4,
      awaitingScreening: 1,
      excludedTitleAbstract: 3,
      reportsSought: 1,
    });
    const log = screeningLogRows(corpus);
    expect(log.filter((cells) => cells[7]?.startsWith('exclude: r'))).toHaveLength(2);
    expect(log.filter((cells) => cells[7]?.startsWith('include: r'))).toHaveLength(1);
  });
});
