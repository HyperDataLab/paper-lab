import { expect, it } from 'vitest';
import { emptyTopicCheck, type TopicCheck } from '../schemas/topicCheck';
import { evaluateTopicCheck } from './checks';
const status = (c: TopicCheck, id: string) => evaluateTopicCheck(c).find((x) => x.id === id)?.status;
const run = (kind: TopicCheck['evidence'][number]['kind'], result: Record<string, unknown>) => ({
  id: kind,
  kind,
  ranAt: '2026-01-01T00:00:00.000Z',
  input: {},
  queryUsed: '',
  result,
});
it('TC-01 statement missing, lengthy and ready', () => {
  const c = emptyTopicCheck();
  expect(status(c, 'statement')).toBe('missing');
  c.statement = 'One. Two. Three. Four.';
  expect(status(c, 'statement')).toBe('needs_work');
  c.statement = 'One.';
  expect(status(c, 'statement')).toBe('ready');
});
it('TC-02 neighbours need differences', () => {
  const c = emptyTopicCheck();
  expect(status(c, 'neighbours')).toBe('missing');
  c.neighbours.push({ ref: '', label: '', difference: '', source: 'researcher' });
  expect(status(c, 'neighbours')).toBe('needs_work');
  c.neighbours[0]!.difference = 'Different';
  expect(status(c, 'neighbours')).toBe('ready');
});
it('TC-03 debate length', () => {
  const c = emptyTopicCheck();
  expect(status(c, 'debate')).toBe('missing');
  c.debate = 'Short';
  expect(status(c, 'debate')).toBe('needs_work');
  c.debate = Array(40).fill('word').join(' ');
  expect(status(c, 'debate')).toBe('ready');
});
it('TC-04 convergence fields and concerns', () => {
  const c = emptyTopicCheck();
  expect(status(c, 'convergence')).toBe('missing');
  c.convergence = { interest: 2, feasibility: 'yes', debateAlive: 'yes' };
  expect(status(c, 'convergence')).toBe('needs_work');
  c.convergence.interest = 3;
  expect(status(c, 'convergence')).toBe('ready');
});
it('TC-05 duplication reviews on review track', () => {
  const c = emptyTopicCheck();
  expect(status(c, 'duplication')).toBe('missing');
  c.evidence = [run('duplication', { reviews: [{ read: false }] })];
  expect(status(c, 'duplication')).toBe('needs_work');
  c.track = 'study';
  expect(status(c, 'duplication')).toBe('ready');
});
it('TC-06 review feasibility thresholds', () => {
  const c = emptyTopicCheck();
  expect(status(c, 'feasibility')).toBe('missing');
  c.evidence = [run('saturation', { total: 4 })];
  expect(status(c, 'feasibility')).toBe('needs_work');
  c.evidence = [run('saturation', { total: 5 })];
  expect(status(c, 'feasibility')).toBe('ready');
  c.evidence = [run('saturation', { total: 501 })];
  expect(status(c, 'feasibility')).toBe('needs_work');
});
it('TC-07 study impact', () => {
  const c = emptyTopicCheck();
  c.track = 'study';
  expect(status(c, 'impact')).toBe('missing');
  c.evidence = [run('impact', { neighbours: [{ citationsPerYear: 0 }] })];
  expect(status(c, 'impact')).toBe('needs_work');
  c.evidence = [run('impact', { neighbours: [{ citationsPerYear: 1 }] })];
  expect(status(c, 'impact')).toBe('ready');
});
it('TC-08 PICO applies to reviews', () => {
  const c = emptyTopicCheck();
  expect(status(c, 'pico')).toBe('missing');
  c.pico = { population: 'a', exposure: 'b', comparison: 'c', outcome: 'd' };
  expect(status(c, 'pico')).toBe('ready');
  c.track = 'study';
  expect(status(c, 'pico')).toBe('not_applicable');
});
it('TC-09 plain summary length', () => {
  const c = emptyTopicCheck();
  expect(status(c, 'plainSummary')).toBe('missing');
  c.plainSummary = 'A. B. C. D.';
  expect(status(c, 'plainSummary')).toBe('needs_work');
  c.plainSummary = 'A.';
  expect(status(c, 'plainSummary')).toBe('ready');
});
it('TC-10 track applicability', () => {
  const c = emptyTopicCheck();
  expect(status(c, 'impact')).toBe('not_applicable');
  c.track = 'study';
  expect(status(c, 'feasibility')).toBe('not_applicable');
});
it('TC-11 newest evidence wins', () => {
  const c = emptyTopicCheck();
  c.evidence = [
    run('saturation', { total: 4 }),
    { ...run('saturation', { total: 10 }), ranAt: '2026-02-01T00:00:00.000Z' },
  ];
  expect(status(c, 'feasibility')).toBe('ready');
});
it('TC-12 unknown evidence is not treated as ready', () => {
  const c = emptyTopicCheck();
  c.evidence = [run('saturation', {})];
  expect(status(c, 'feasibility')).toBe('needs_work');
});
