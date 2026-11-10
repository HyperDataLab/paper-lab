import { expect, it } from 'vitest';
import type {
  Analysis,
  MeasurementsRecord,
  Paper,
  PaperChecksRecord,
  PaperInsightsRecord,
  PaperOverviewRecord,
  PaperReviewsRecord,
  StanceRecord,
} from '../schemas';
import { collectFindings, collectMarks, countBySection, segmentText, type PaperMark } from './index';

const RUN = '00000000-0000-4000-8000-0000000000aa';
const paper = {
  id: '00000000-0000-4000-8000-000000000001',
  sections: [
    { id: 's1', heading: 'Introduction' },
    { id: 's2', heading: 'Results' },
  ],
  paragraphs: [
    { id: 'p1', sectionId: 's1', kind: 'body', text: 'We claim a large gain.' },
    { id: 'p2', sectionId: 's2', kind: 'body', text: 'Accuracy rose to 91 percent.' },
  ],
} as unknown as Paper;
const checks = {
  report: {
    checks: [
      {
        id: 'numbers_consistency',
        findings: [
          {
            id: 'f1',
            checkId: 'numbers_consistency',
            severity: 'moderate',
            message: 'Số 91 không khớp bảng',
            locations: [{ paragraphId: 'p2', start: 17, end: 19 }],
            evidence: ['91', '89'],
          },
        ],
      },
      {
        id: 'citations_references',
        findings: [
          {
            id: 'f2',
            checkId: 'citations_references',
            severity: 'info',
            message: 'Thiếu tài liệu',
            locations: [],
            evidence: [],
          },
        ],
      },
    ],
  },
  decisions: [{ findingId: 'f2', status: 'dismissed_by_human', note: '', at: '2026-01-01T00:00:00.000Z' }],
} as unknown as PaperChecksRecord;
const reviews = (revealed: boolean) =>
  ({
    humanNotes: { revealedAt: revealed ? '2026-01-01T00:00:00.000Z' : null },
    decisions: [{ pointId: 'r1', status: 'confirmed_by_human', note: '', at: '2026-01-01T00:00:00.000Z' }],
    runs: [
      {
        merged: [
          {
            id: 'r1',
            severity: 'major',
            anchor: { paragraphId: 'p1', start: 3, end: 8 },
            wordings: [
              {
                kind: 'weakness',
                dimension: 'reproducibility',
                point: 'Không có mã nguồn',
                rationale: 'Không lặp lại được.',
              },
            ],
          },
          {
            id: 'r2',
            severity: 'minor',
            anchor: { paragraphId: 'p1', start: 0, end: 2 },
            wordings: [{ kind: 'strength', dimension: 'clarity', point: 'Rõ ràng', rationale: '' }],
          },
        ],
      },
    ],
  }) as unknown as PaperReviewsRecord;
const analyses = [
  {
    id: 'a1',
    origin: { kind: 'paper', paperId: paper.id, paragraphId: 'p2' },
    issues: [
      {
        id: 'i1',
        type: 'FUZZY_VERB',
        severity: 'minor',
        status: 'candidate',
        why: 'Động từ mơ hồ.',
        spans: [{ start: 9, end: 13, role: 'verb' }],
      },
      {
        id: 'i2',
        type: 'MEANING_RISK',
        severity: 'critical',
        status: 'dismissed_by_human',
        why: 'Sai nghĩa.',
        spans: [{ start: 0, end: 8, role: 'x' }],
      },
    ],
  },
  {
    id: 'a2',
    origin: null,
    issues: [
      {
        id: 'i3',
        type: 'FUZZY_VERB',
        severity: 'minor',
        status: 'candidate',
        why: '',
        spans: [{ start: 0, end: 1, role: 'x' }],
      },
    ],
  },
] as unknown as Analysis[];
const overview = {
  transitions: {
    findings: [
      {
        id: 't1',
        type: 'FLOW_BREAK_CANDIDATE',
        severity: 'moderate',
        status: 'confirmed_by_model',
        why: 'Hai đoạn không nối nhau.',
        from: { paragraphId: 'p1', span: { start: 0, end: 2 } },
        to: { paragraphId: 'p2', span: { start: 0, end: 8 } },
      },
    ],
  },
} as unknown as PaperOverviewRecord;
const measurements = {
  decisions: [{ run_id: RUN, item_id: 'm1', field: null, decision: 'accept' }],
  runs: [
    {
      id: RUN,
      profile: {
        evidence: [
          { id: 'e1', blockId: 'p2', span: { start: 0, end: 8 } },
          { id: 'e2', blockId: 'p2', span: null },
        ],
        findings: [
          {
            id: 'm1',
            type: 'claim_evidence_gap',
            severity: 'high',
            explanation: 'Khẳng định rộng hơn kết quả.',
            evidence_ids: ['e1', 'e2'],
          },
        ],
      },
    },
  ],
} as unknown as MeasurementsRecord;

it('R2 reads five kinds of stored results into one finding shape, in the paper order', () => {
  const found = collectFindings({ paper, checks, reviews: reviews(true), analyses, overview, measurements });
  expect(found.map((item) => item.id)).toEqual([
    'transition:t1',
    'review:r1',
    'writing:a1:i2',
    'measurement:m1',
    'writing:a1:i1',
    'checks:f1',
    'checks:f2',
  ]);
  const byId = Object.fromEntries(found.map((item) => [item.id, item]));
  // Three severity scales and three decision vocabularies become one of each.
  expect(byId['checks:f1']).toMatchObject({
    criterion: 'evidence',
    severity: 'medium',
    origin: 'rule',
    status: 'open',
    sectionId: 's2',
  });
  expect(byId['checks:f2']).toMatchObject({ criterion: 'context', status: 'dismissed', sectionId: null });
  expect(byId['review:r1']).toMatchObject({
    criterion: 'evidence',
    severity: 'high',
    origin: 'ai',
    status: 'confirmed',
    title: 'Không có mã nguồn',
  });
  expect(byId['writing:a1:i1']).toMatchObject({
    criterion: 'writing',
    severity: 'low',
    origin: 'rule',
    code: 'FUZZY_VERB',
  });
  expect(byId['writing:a1:i2']).toMatchObject({ severity: 'high', status: 'dismissed' });
  expect(byId['transition:t1']?.locations).toHaveLength(2);
  // Evidence in a table cell has no text span, so only the located part is kept.
  expect(byId['measurement:m1']).toMatchObject({
    status: 'confirmed',
    title: 'Khẳng định vượt quá kết quả đo',
  });
  expect(byId['measurement:m1']?.locations).toEqual([{ paragraphId: 'p2', start: 0, end: 8 }]);
});

it('R2 keeps the AI review out until the reader has saved or skipped their own notes, and never lists a strength', () => {
  const hidden = collectFindings({ paper, reviews: reviews(false) });
  expect(hidden).toEqual([]);
  expect(collectFindings({ paper, reviews: reviews(true) }).map((item) => item.id)).toEqual(['review:r1']);
});

it('R2 marks the text with findings and with what the analyses described, leaving out what a person dismissed', () => {
  const insights = {
    decisions: [{ run_id: RUN, item_id: 'arg2', decision: 'dismiss' }],
    argumentRuns: [
      {
        id: RUN,
        arguments: [
          {
            id: 'arg1',
            importance: 'main',
            claim: { paragraphId: 'p1', start: 3, end: 22 },
            data: [{ paragraphId: 'p2', start: 0, end: 8 }],
          },
          { id: 'arg2', importance: 'supporting', claim: { paragraphId: 'p1', start: 0, end: 2 }, data: [] },
        ],
      },
    ],
    snapshotRuns: [
      {
        id: RUN,
        values: [
          { id: 'v1', source: { paragraphId: 'p2', start: 17, end: 27 } },
          { id: 'v2', source: null },
        ],
      },
    ],
  } as unknown as PaperInsightsRecord;
  const stance = {
    decisions: [],
    runs: [{ id: RUN, annotations: [{ id: 'st1', paragraphId: 'p1', start: 0, end: 2, marker: 'We' }] }],
  } as unknown as StanceRecord;
  const marks = collectMarks({ paper, checks, analyses, insights, stance });
  const ids = marks.map((mark) => mark.id);
  expect(ids).toContain('checks:f1#0');
  expect(ids).not.toContain('writing:a1:i2#0');
  expect(ids).toEqual(expect.arrayContaining(['claim:arg1', 'data:arg1:0', 'snapshot:v1', 'stance:st1']));
  expect(ids).not.toContain('claim:arg2');
  expect(marks.find((mark) => mark.id === 'claim:arg1')).toMatchObject({
    criterion: 'claim',
    label: 'Luận điểm chính',
    findingId: null,
  });
});

it('R2 cuts a paragraph into stretches by the marks covering them, by code point', () => {
  const mark = (id: string, start: number, end: number, findingId: string | null = null): PaperMark => ({
    id,
    paragraphId: 'p',
    start,
    end,
    criterion: 'claim',
    label: id,
    findingId,
    view: 'toulmin',
  });
  expect(segmentText('plain', [])).toEqual([{ text: 'plain', marks: [] }]);
  // "😀" is one code point but two UTF-16 units; offsets must not split it.
  const segments = segmentText('a😀bcdef', [mark('x', 1, 4), mark('y', 3, 6, 'finding')]);
  expect(segments.map((item) => [item.text, item.marks.map((m) => m.id)])).toEqual([
    ['a', []],
    ['😀b', ['x']],
    ['c', ['y', 'x']],
    ['de', ['y']],
    ['f', []],
  ]);
  expect(segmentText('abc', [mark('late', 10, 12)])).toEqual([{ text: 'abc', marks: [] }]);
});

it('R2 counts findings per section and criterion for the summary table', () => {
  const found = collectFindings({ paper, checks, analyses });
  expect(countBySection(found)).toEqual(
    expect.arrayContaining([
      { sectionId: 's2', criterion: 'writing', count: 2 },
      { sectionId: 's2', criterion: 'evidence', count: 1 },
      { sectionId: null, criterion: 'context', count: 1 },
    ]),
  );
});
