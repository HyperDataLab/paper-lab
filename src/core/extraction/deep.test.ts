import { describe, expect, it } from 'vitest';
import type { Candidate, ExtractionProject } from '../schemas';
import {
  applySuggestions,
  candidateFromWork,
  decideCandidate,
  emptyDeep,
  isGrounded,
  mergeCandidates,
  paperEvidence,
  papersFromCandidates,
  planFromOutput,
  synthesisInput,
  synthesisMarkdown,
  verifySynthesis,
} from './deep';

const at = '2026-01-01T00:00:00.000Z';
const work = (over: Record<string, unknown> = {}) => ({
  id: 'https://openalex.org/W1',
  doi: 'https://doi.org/10.1234/A',
  display_name: 'Edge latency',
  publication_year: 2023,
  authorships: [{ author: { display_name: 'Ng' } }, {}],
  primary_location: { source: { display_name: 'IEEE' } },
  abstract_inverted_index: { Edge: [0], helps: [1] },
  cited_by_count: 4,
  ...over,
});
const candidate = (over: Partial<Candidate> = {}) => ({
  ...(candidateFromWork(work(), 'q1') as Candidate),
  ...over,
});

describe('deep research', () => {
  it('cleans a plan and waits for approval', () => {
    const plan = planFromOutput({
      concepts: ['edge', ' edge '],
      queries: Array.from({ length: 10 }, (_, i) => `q${i}`),
      inclusion: ['a', ''],
      exclusion: [],
      fromYear: 2020,
      toYear: null,
    });
    expect(plan).toMatchObject({ concepts: ['edge'], inclusion: ['a'], approvedAt: null, perQuery: 15 });
    expect(plan.queries).toHaveLength(8);
    expect(emptyDeep()).toEqual({ plan: null, rounds: [], candidates: [], syntheses: [] });
  });
  it('maps an OpenAlex work and skips one without a title', () => {
    expect(candidate()).toMatchObject({
      key: '10.1234/a',
      openalexId: 'W1',
      title: 'Edge latency',
      authors: ['Ng'],
      venue: 'IEEE',
      abstract: 'Edge helps',
      citedBy: 4,
      foundBy: ['q1'],
      status: 'candidate',
    });
    expect(candidateFromWork(work({ display_name: null, title: null }), 'q')).toBeNull();
    expect(candidateFromWork(null, 'q')).toBeNull();
    expect(candidateFromWork(work({ doi: null, id: undefined }), 'q')?.key).toBe('edge latency');
  });
  it('keeps a work found twice once, by DOI or by title and year, and keeps decisions', () => {
    const decided = { ...candidate(), status: 'included' as const };
    const sameTitle = candidateFromWork(
      work({ doi: null, id: 'https://openalex.org/W2' }),
      'q2',
    ) as Candidate;
    const other = candidateFromWork(
      work({ doi: null, id: 'https://openalex.org/W3', display_name: 'Other' }),
      'q3',
    ) as Candidate;
    const { candidates, added } = mergeCandidates(
      [decided],
      [candidate({ foundBy: ['q2'] }), sameTitle, other],
    );
    expect(added).toBe(1);
    expect(candidates[0]).toMatchObject({ status: 'included', foundBy: ['q1', 'q2'] });
  });
  it('suggests only for undecided candidates and lets a person decide', () => {
    const list = [candidate(), candidate({ key: 'b', status: 'excluded' })];
    const suggested = applySuggestions(list, {
      decisions: [
        { key: '10.1234/a', decision: 'included', reason: 'Đúng chủ đề' },
        { key: 'b', decision: 'included', reason: 'x' },
        { key: 'zz', decision: 'excluded', reason: 'x' },
      ],
    });
    expect(suggested[0]?.suggestion).toEqual({ decision: 'included', reason: 'Đúng chủ đề' });
    expect(suggested[0]?.status).toBe('candidate');
    expect(suggested[1]?.suggestion).toBeNull();
    const decided = decideCandidate(suggested, '10.1234/a', 'included', at);
    expect(decided[0]).toMatchObject({ status: 'included', reason: 'Đúng chủ đề', decidedAt: at });
    expect(decideCandidate(decided, '10.1234/a', 'candidate', at, 'mở lại')[0]).toMatchObject({
      decidedAt: null,
      reason: 'mở lại',
    });
  });
  it('brings only included candidates into the matrix with their access tier', () => {
    const papers = papersFromCandidates([
      candidate({ status: 'included' }),
      candidate({ key: 'n', status: 'included', abstract: null }),
      candidate({ key: 'x', status: 'excluded' }),
    ]);
    expect(papers.map((paper) => [paper.key, paper.access])).toEqual([
      ['search:10.1234/a', 'ABSTRACT_ONLY'],
      ['search:n', 'METADATA_ONLY'],
    ]);
    expect(papers[0]?.source).toEqual({ kind: 'search', candidateKey: '10.1234/a' });
  });
  const paper = (key: string, title: string) => ({
    key,
    source: { kind: 'search' as const, candidateKey: key },
    title,
    authors: [],
    year: 2023,
    venue: null,
    doi: key === 'a' ? '10.1234/a' : null,
    access: 'ABSTRACT_ONLY' as const,
    abstract: null,
    revision: 'r',
    screening: 'included' as const,
  });
  const quote = (text: string, stance: 'supports' | 'conflicts' = 'supports') => ({
    paragraphId: 'p1',
    section: 'Results',
    page: 4,
    start: 0,
    end: text.length,
    quote: text,
    stance,
  });
  const cell = (paperKey: string, value: string | null, status = 'EXTRACTED') =>
    ({
      paperKey,
      fieldKey: 'results',
      value,
      status,
      sourceAccess: 'ABSTRACT_ONLY',
      verification: null,
      // Paper b has a value a person typed in, with no passage behind it.
      evidence: paperKey === 'a' ? [quote('latency was 10 ms'), quote('about 12 ms', 'conflicts')] : [],
    }) as unknown as ExtractionProject['cells'][number];
  const project = {
    title: 'P',
    researchQuestion: 'RQ',
    papers: [paper('a', 'Alpha'), paper('b', 'Beta'), paper('c', 'Gamma')],
    fields: [{ key: 'results', label: 'Results', hidden: false }],
    cells: [cell('a', '10 ms'), cell('b', '20 ms'), cell('c', 'x', 'CONFLICT'), cell('c', null)],
  } as unknown as ExtractionProject;
  it('gives synthesis only shown values, never conflicts or withheld ones', () => {
    const rows = synthesisInput(project);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('[P1] Alpha (2023) · source: ABSTRACT_ONLY');
    expect(rows[1]).toContain('[P2] Beta');
    expect(rows[0]).toContain('[P1.1] Results: 10 ms');
  });
  it('grounds each citation in the passage behind its value and drops unknown references', () => {
    const { claims, dropped } = verifySynthesis(
      {
        claims: [
          {
            kind: 'disagreement',
            text: 'Khác nhau',
            paperKeys: ['P1.1', '[p2.1]', 'P1.1', 'a', 'ghost', 'c', 'P9.1'],
            caveat: null,
          },
          { kind: 'theme', text: 'Không nguồn', paperKeys: ['ghost'], caveat: 'ít bài' },
          { kind: 'agreement', text: 'Chỉ nêu tên bài', paperKeys: ['P1', 'P2.1'], caveat: null },
          { kind: 'gap', text: 'Thiếu đo năng lượng', paperKeys: [], caveat: null },
        ],
      },
      project,
    );
    expect(claims[0]).toMatchObject({ paperKeys: ['a', 'b'], supported: true });
    expect(claims[1]).toMatchObject({ paperKeys: [], supported: false });
    // One citation per value: the passage that supports it, never the conflicting one.
    expect(claims[0]?.citations).toEqual([
      {
        paperKey: 'a',
        fieldKey: 'results',
        fieldLabel: 'Results',
        value: '10 ms',
        fullText: false,
        humanVerified: false,
        quotes: [
          { paragraphId: 'p1', section: 'Results', page: 4, start: 0, end: 17, quote: 'latency was 10 ms' },
        ],
      },
      expect.objectContaining({ paperKey: 'b', quotes: [] }),
    ]);
    expect(claims.map((claim) => isGrounded(claim))).toEqual([true, false, false, false]);
    // A bare paper label names the paper but grounds nothing.
    expect(claims[2]).toMatchObject({ paperKeys: ['a', 'b'], supported: true });
    expect(claims[2]?.citations.map((item) => item.paperKey)).toEqual(['b']);
    expect(claims[3]?.supported).toBe(true);
    // 'c' is a real paper, but the model was never shown it (its only value is a conflict).
    expect(dropped).toBe(4);
    const synthesis = {
      id: '00000000-0000-4000-8000-000000000001',
      createdAt: at,
      model: 'm',
      promptVersion: 'synthesis-3',
      paperKeys: ['a', 'b'],
      claims,
      droppedRefs: dropped,
    };
    expect(paperEvidence(synthesis, 'a')).toEqual([
      { citation: expect.objectContaining({ fieldKey: 'results' }), claims: ['Khác nhau'] },
    ]);
    expect(paperEvidence(synthesis, 'b')[0]?.claims).toEqual(['Khác nhau', 'Chỉ nêu tên bài']);
    const markdown = synthesisMarkdown(project, {
      ...synthesis,
      claims: [
        ...claims,
        {
          kind: 'gap',
          text: 'Chưa thấy đo năng lượng',
          paperKeys: [],
          caveat: null,
          supported: false,
          citations: [],
        },
      ],
    });
    expect(markdown).toContain('## Điểm khác biệt\n- Khác nhau [1][2]');
    expect(markdown).toContain('Không nguồn (chưa có nguồn trong ma trận) — Lưu ý: ít bài');
    expect(markdown).toContain('## Khoảng trống ứng viên');
    expect(markdown).toContain(
      '1. Alpha (2023). https://doi.org/10.1234/a\n   - Results: “latency was 10 ms” (tr. 4) (tóm tắt)',
    );
  });
});
