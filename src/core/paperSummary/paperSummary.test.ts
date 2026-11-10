import { expect, it } from 'vitest';
import type { PaperInsightsRecord } from '../schemas';
import { summarizePaper } from './index';

const RUN = '00000000-0000-4000-8000-0000000000aa';
const span = (paragraphId: string, excerpt: string) => ({
  paragraphId,
  sectionId: 's',
  page: 1,
  start: 0,
  end: excerpt.length,
  excerpt,
});
const insights = {
  decisions: [
    { run_id: RUN, item_id: 'r4', decision: 'dismiss', at: '2026-01-01T00:00:00.000Z' },
    { run_id: RUN, item_id: 'a2', decision: 'dismiss', at: '2026-01-01T00:00:00.000Z' },
    { run_id: RUN, item_id: 'a2', decision: 'reopen', at: '2026-01-02T00:00:00.000Z' },
  ],
  rhetoricRuns: [
    {
      id: RUN,
      items: [
        { id: 'r1', category: 'niche', rationale: '', ...span('p1', 'No study has measured X.') },
        { id: 'r2', category: 'occupy', rationale: '', ...span('p1', 'We measure X at scale.') },
        { id: 'r3', category: 'threat_external', rationale: '', ...span('p9', 'One site only.') },
        { id: 'r4', category: 'limitation', rationale: '', ...span('p9', 'Small sample.') },
        { id: 'r5', category: 'territory', rationale: '', ...span('p1', 'X matters.') },
      ],
    },
  ],
  snapshotRuns: [
    {
      id: RUN,
      values: [
        {
          id: 'v1',
          field: 'sample_size',
          status: 'reported',
          value: '240',
          source: span('p3', '240 participants'),
        },
        { id: 'v2', field: 'duration', status: 'not_reported', value: null, source: null },
        { id: 'v3', field: 'methods', status: 'unverified', value: 'RCT', source: null },
      ],
    },
  ],
  argumentRuns: [
    {
      id: RUN,
      arguments: [
        {
          id: 'a1',
          importance: 'main',
          claim: span('p5', 'X improves Y.'),
          data: [span('p6', 'Y rose 12%.')],
          statedWarrant: null,
          inferredWarrant: 'A rise in Y reflects X.',
          backing: [],
          qualifier: span('p5', 'in most cases'),
          rebuttals: [span('p7', 'unless Z')],
        },
        {
          id: 'a2',
          importance: 'main',
          claim: span('p5', 'X is cheap.'),
          data: [],
          statedWarrant: span('p5', 'Cost follows size.'),
          inferredWarrant: null,
          backing: [],
          qualifier: null,
          rebuttals: [],
        },
        {
          id: 'a3',
          importance: 'supporting',
          claim: span('p5', 'A side point.'),
          data: [],
          statedWarrant: null,
          inferredWarrant: null,
          backing: [],
          qualifier: null,
          rebuttals: [],
        },
      ],
    },
  ],
} as unknown as PaperInsightsRecord;

it('R3 gathers what the author says from the stored analyses, leaving out what a person dismissed', () => {
  const summary = summarizePaper(insights);
  expect(summary.has).toEqual({ rhetoric: true, snapshot: true, arguments: true });
  expect(summary.gap.map((item) => item.excerpt)).toEqual(['No study has measured X.']);
  expect(summary.contribution.map((item) => item.excerpt)).toEqual(['We measure X at scale.']);
  // r4 was dismissed; the validity threat stays.
  expect(summary.limits.map((item) => item.id)).toEqual(['r3']);
  // Only a value with a verified quote is a fact; "not reported" and "unverified" are not shown as facts.
  expect(summary.facts).toEqual([
    expect.objectContaining({
      field: 'sample_size',
      value: '240',
      source: expect.objectContaining({ paragraphId: 'p3' }),
    }),
  ]);
});

it("R3 lists main claims with their data and limits, and never passes an inferred warrant off as the author's", () => {
  const { claims } = summarizePaper(insights);
  // a2 was dismissed and then reopened, so it is back; the supporting claim is not a main claim.
  expect(claims.map((item) => item.id)).toEqual(['a1', 'a2']);
  expect(claims[0]).toMatchObject({
    data: [expect.objectContaining({ excerpt: 'Y rose 12%.' })],
    limits: [
      expect.objectContaining({ excerpt: 'in most cases' }),
      expect.objectContaining({ excerpt: 'unless Z' }),
    ],
    warrant: { text: 'A rise in Y reflects X.', inferred: true },
  });
  expect(claims[1]?.warrant).toEqual({ text: 'Cost follows size.', inferred: false });
});

it('R3 says which analyses have not run instead of returning empty facts as if nothing were there', () => {
  expect(summarizePaper(undefined)).toEqual({
    has: { rhetoric: false, snapshot: false, arguments: false },
    gap: [],
    contribution: [],
    facts: [],
    claims: [],
    limits: [],
  });
});
