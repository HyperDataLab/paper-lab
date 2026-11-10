import { expect, it } from 'vitest';
import { runFreshness, type RunFacts } from './runFreshness';

const current: RunFacts = { sectionIds: ['a', 'b'], promptVersions: { one: '1', two: '2' }, model: 'model' };
it('R6 detects each freshness reason and their combination', () => {
  expect(runFreshness({ ...current, sectionIds: ['a'] }, current)).toEqual(['scope']);
  expect(runFreshness({ ...current, promptVersions: { one: '1', two: 'old' } }, current)).toEqual(['prompt']);
  expect(runFreshness({ ...current, model: 'old' }, current)).toEqual(['model']);
  expect(runFreshness({ sectionIds: [], promptVersions: {}, model: 'old' }, current)).toEqual([
    'scope',
    'prompt',
    'model',
  ]);
  expect(runFreshness({ ...current, sectionIds: ['b', 'a'] }, current)).toBeNull();
  // A result that read more sections than the reader now wants still covers what they ask for.
  expect(runFreshness({ ...current, sectionIds: ['a', 'b', 'c'] }, current)).toBeNull();
});
it('R6 ignores scope for snapshots', () => {
  expect(runFreshness(current, { promptVersions: current.promptVersions, model: current.model })).toBeNull();
});
