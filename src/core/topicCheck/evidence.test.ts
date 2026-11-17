import { expect, it } from 'vitest';
import { emptyTopicCheck, TopicCheckSchema } from '../schemas/topicCheck';
import { trimDebate, trimDuplication, trimImpact, trimSaturation } from './evidence';
const paper = {
  id: 'W1',
  title: 'Example',
  cited_by_count: 4,
  counts_by_year: { '2025': 2 },
  url: 'https://example.test',
  authors: ['private extra'],
  venue: { name: 'Journal', issn: 'extra' },
};
it('TC-19 trims tool outputs and caps paper lists', () => {
  const duplication = trimDuplication({
    mode: 'sr',
    neighbours: Array(18).fill(paper),
    existing_reviews: [paper],
    query_used: 'query',
  });
  expect(duplication.neighbours).toHaveLength(15);
  expect(duplication.neighbours[0]).not.toHaveProperty('authors');
  expect(duplication.neighbours[0]?.venue).toEqual({ name: 'Journal' });
  expect(
    trimSaturation({ window: '2020-2026', counts_by_year: {}, total_estimate: 2, closest_recent: [paper] })
      .closest_recent,
  ).toHaveLength(1);
  expect(
    trimDebate({
      window: '2024-2026',
      records_in_window: 2,
      recent: [],
      common_ancestors: [{ ...paper, shared_by: 2 }],
    }).common_ancestors[0]?.shared_by,
  ).toBe(2);
  expect(
    trimImpact({
      papers: [
        { ref: 'W1', ok: true, paper },
        { ref: 'bad', ok: false, error: 'failed' },
      ],
    }).papers,
  ).toHaveLength(2);
});
it('TC-20 validates kind-specific snapshots and defaults old reviewed IDs', () => {
  const check = emptyTopicCheck();
  const old: Partial<typeof check> = { ...check };
  delete old.reviewedIds;
  expect(TopicCheckSchema.parse(old).reviewedIds).toEqual([]);
  const base = { id: '1', ranAt: '2026-01-01T00:00:00.000Z', input: {}, queryUsed: 'q' };
  expect(
    TopicCheckSchema.safeParse({
      ...check,
      evidence: [{ ...base, kind: 'debate', result: { mode: 'sr', neighbours: [] } }],
    }).success,
  ).toBe(false);
  expect(
    TopicCheckSchema.safeParse({
      ...check,
      evidence: [{ ...base, kind: 'duplication', result: { mode: 'sr', neighbours: [] } }],
    }).success,
  ).toBe(true);
});
