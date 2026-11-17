import { describe, expect, it } from 'vitest';
import { contributionGraph, groupContributionStages } from './graph';
import type { PaperModel } from '../schemas';

const knowledge: PaperModel['knowledge'] = {
  phrases: [
    { id: 'a', key: '1', start: 0, end: 5, text: 'Model' },
    { id: 'b', key: '1', start: 0, end: 4, text: 'uses' },
    { id: 'c', key: '1', start: 0, end: 4, text: 'Data' },
    { id: 'd', key: '2', start: 0, end: 8, text: '  MODEL  ' },
  ],
  triples: [
    { unit: 'Model', subject: 'a', predicate: 'b', object: 'c', key: '1' },
    { unit: 'Results', subject: 'd', predicate: 'b', object: 'c', key: '2' },
  ],
};

describe('contribution presentation', () => {
  it('groups triples by stage and omits empty units', () => {
    const stages = groupContributionStages(knowledge.triples);
    expect(stages.map((stage) => stage.count)).toEqual([0, 1, 0, 1]);
    expect(stages[1]?.groups.map((group) => group.unit)).toEqual(['Model']);
    expect(stages[0]?.groups).toEqual([]);
  });
  it('merges case and whitespace variants and lays out deterministically within the viewBox', () => {
    const graph = contributionGraph(knowledge);
    expect(graph.nodes).toHaveLength(2);
    expect(graph).toEqual(contributionGraph(knowledge));
    expect(graph.nodes.every((node) => node.x >= 0 && node.x <= 800 && node.y >= 0 && node.y <= 500)).toBe(
      true,
    );
  });
});
