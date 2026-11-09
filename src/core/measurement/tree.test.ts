import { expect, it } from 'vitest';
import { buildMeasurementTree, flattenMeasurementTree } from './tree';
import { fixtureProfile } from './testFixture';

const byId = (profile = fixtureProfile()) => {
  const flat = flattenMeasurementTree(buildMeasurementTree(profile));
  return { flat, find: (id: string) => flat.find((node) => node.id === id) };
};

it('nests results under their metric and experiment', () => {
  const { find } = byId();
  expect(find('exp')?.count).toBe(1);
  expect(find('exp/e:exp-1/m:mu-1')?.label).toBe('Accuracy');
  expect(find('exp/e:exp-1/m:mu-1/r:r-1')?.label).toBe('Baseline: 0.123 ± 0.004 %');
  expect(find('exp/e:exp-1')?.count).toBe(1);
});

it('lists a claim with the results linked to it', () => {
  const { find } = byId();
  expect(find('claims/c:cl-1')?.children?.map((node) => node.ref)).toEqual([{ kind: 'result', id: 'r-1' }]);
});

it('gives every position a unique id even when an item repeats', () => {
  const { flat } = byId();
  expect(new Set(flat.map((node) => node.id)).size).toBe(flat.length);
  expect(flat.filter((node) => 'id' in node.ref && node.ref.id === 'r-1').length).toBeGreaterThan(1);
});

it('collects loose items and the review queue', () => {
  const profile = fixtureProfile();
  profile.results[0]!.experiment_id = null;
  profile.results[0]!.metric_usage_id = null;
  profile.results[0]!.needs_review = true;
  profile.metrics[0]!.experiment_ids = [];
  profile.metrics[0]!.unit.needs_review = true;
  profile.claims[0]!.needs_review = true;
  profile.experiments[0]!.protocol.seeds.needs_review = true;
  const { find } = byId(profile);
  expect(find('loose')?.children?.map((node) => node.ref)).toEqual([
    { kind: 'metric', id: 'mu-1' },
    { kind: 'result', id: 'r-1' },
  ]);
  expect(find('review')?.count).toBe(4);
  expect(find('exp/e:exp-1')?.flagged).toBe(true);
});

it('hides the unlinked branch when everything is placed', () => {
  expect(byId().find('loose')).toBeUndefined();
});

it('shows a taxonomy instead of experiments for a survey', () => {
  const profile = fixtureProfile();
  profile.paper_type = 'SURVEY_SLR';
  const field = profile.metrics[0]!.unit;
  profile.taxonomy = [
    { id: 'tx-1', construct: 'Quality', metric: 'F1', how_measured: field, domain: field, evidence_ids: [] },
  ];
  const { find } = byId(profile);
  expect(find('exp')).toBeUndefined();
  expect(find('taxonomy/t:tx-1')?.label).toBe('Quality · F1');
});

it('shortens long labels', () => {
  const profile = fixtureProfile();
  profile.claims[0]!.text = 'x'.repeat(200);
  expect(byId(profile).find('claims/c:cl-1')?.label).toHaveLength(70);
});
