import { describe, expect, it } from 'vitest';
import { contributionGraph, groupContributionStages, layoutContributionGraph } from './index';
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

  it('maps each triple endpoint through its phrase ID before merging equivalent entities', () => {
    const graph = contributionGraph(knowledge);
    expect(graph.edges.map(({ source, target }) => [source, target])).toEqual([
      ['model', 'data'],
      ['model', 'data'],
    ]);
  });

  it('preserves directed, reverse, and self-loop relationships', () => {
    const graph = contributionGraph({
      ...knowledge,
      triples: [
        { unit: 'Model', subject: 'a', predicate: 'b', object: 'c', key: '1' },
        { unit: 'Results', subject: 'c', predicate: 'b', object: 'a', key: '2' },
        { unit: 'Results', subject: 'a', predicate: 'b', object: 'a', key: '3' },
      ],
    });
    expect(graph.edges.map(({ source, target }) => [source, target])).toEqual([
      ['model', 'data'],
      ['data', 'model'],
      ['model', 'model'],
    ]);
  });

  it('keeps the highest-degree entity central and places other nodes on a compact ring', () => {
    const neighbors = Array.from({ length: 12 }, (_, index) => ({
      id: `neighbor-${index}`,
      label: index === 0 ? 'data partitioning strategy with a long descriptive name' : `result ${index}`,
      degree: 1,
    }));
    const nodes = [
      { id: 'asyncdefender', label: 'AsyncDefender', degree: 15 },
      { id: 'classical', label: 'classical datasets', degree: 3 },
      ...neighbors,
    ];
    const edges = [
      { source: 'asyncdefender', target: 'classical' },
      { source: 'asyncdefender', target: 'classical' },
      { source: 'asyncdefender', target: 'classical' },
      ...neighbors.map((node) => ({ source: 'asyncdefender', target: node.id })),
    ];
    const positions = layoutContributionGraph(nodes, edges);
    const byId = new Map(positions.map((position) => [position.id, position]));
    expect(byId.get('asyncdefender')).toMatchObject({ x: 0, y: 0 });
    expect(layoutContributionGraph(nodes, edges)).toEqual(positions);
    const radii = positions
      .filter((position) => position.id !== 'asyncdefender')
      .map((position) => Math.hypot(position.x, position.y));
    expect(radii[0]).toBeGreaterThanOrEqual(168);
    expect(radii[0]).toBeLessThanOrEqual(400);
    radii.forEach((radius) => expect(radius).toBeCloseTo(radii[0] ?? 0, 6));
  });

  it('places contribution stages on concentric rings and gives the hub a larger marker', () => {
    const nodes = [
      { id: 'hub', label: 'AsyncDefender', degree: 8 },
      { id: 'problem', label: 'Byzantine attacks', degree: 2, stage: 0 },
      { id: 'method', label: 'AsyncDefender method', degree: 3, stage: 1 },
      { id: 'experiment', label: 'classical datasets', degree: 2, stage: 2 },
      { id: 'result', label: '0.9 accuracy', degree: 1, stage: 3 },
    ];
    const positions = layoutContributionGraph(nodes, []);
    const byId = new Map(positions.map((position) => [position.id, position]));
    const radius = (id: string) => {
      const position = byId.get(id);
      return Math.hypot(position?.x ?? 0, position?.y ?? 0);
    };

    expect(byId.get('hub')).toMatchObject({ x: 0, y: 0, dotDiameter: 68 });
    expect(byId.get('problem')?.dotDiameter).toBe(48);
    expect(radius('problem')).toBeLessThan(radius('method'));
    expect(radius('method')).toBeCloseTo(radius('experiment'), 6);
    expect(radius('experiment')).toBeLessThan(radius('result'));
  });

  it('adds local angular room for a long label on the lower ring', () => {
    const ringNodes = Array.from({ length: 12 }, (_, index) => ({
      id: `node-${index}`,
      label:
        index === 6
          ? 'asynchronous Byzantine defense strategy with heterogeneous participation'
          : `result ${index}`,
      degree: 12 - index,
    }));
    const nodes = [{ id: 'center', label: 'AsyncDefender', degree: 30 }, ...ringNodes];
    const edges = ringNodes.map((node) => ({ source: 'center', target: node.id }));
    const positions = layoutContributionGraph(nodes, edges);
    const byId = new Map(positions.map((position) => [position.id, position]));
    const long = byId.get('node-6');
    expect(long?.labelSide).toBe('bottom');
    expect(long?.labelHeight).toBe(40);
    expect(long?.labelWidth).toBeLessThanOrEqual(144);
    const angle = (position: typeof long) => position?.angle ?? 0;
    const gap = (from: number, to: number) =>
      (angle(byId.get(`node-${to}`)) - angle(byId.get(`node-${from}`)) + Math.PI * 2) % (Math.PI * 2);
    const longSpace = gap(5, 6) + gap(6, 7);
    const shortSpace = gap(0, 1) + gap(1, 2);
    expect(longSpace).toBeGreaterThan(shortSpace);
    const ring = positions.slice(1);
    ring.forEach((current, index) => {
      const next = ring[(index + 1) % ring.length];
      if (!next) return;
      const tangentExtent = (position: (typeof ring)[number]) => {
        const tangentX = -Math.sin(position.angle);
        const tangentY = Math.cos(position.angle);
        const labelCenterX = position.labelX + position.labelWidth / 2 - position.dotX;
        const labelCenterY = position.labelY + position.labelHeight / 2 - position.dotY;
        const labelExtent =
          (Math.abs(tangentX) * position.labelWidth) / 2 + (Math.abs(tangentY) * position.labelHeight) / 2;
        const offset = Math.abs(tangentX * labelCenterX + tangentY * labelCenterY);
        return Math.max(position.dotDiameter / 2, labelExtent + offset);
      };
      const centerDistance = Math.hypot(next.x - current.x, next.y - current.y);
      expect(centerDistance, `ring segment ${index}`).toBeGreaterThanOrEqual(
        tangentExtent(current) + tangentExtent(next) + 19.5,
      );
    });
    expect(layoutContributionGraph(nodes, edges)).toEqual(positions);
  });

  it('keeps disconnected entities in separate deterministic clusters and ignores missing endpoints', () => {
    const nodes = [
      { id: 'main', label: 'main entity', degree: 3 },
      { id: 'related', label: 'related entity', degree: 1 },
      { id: 'island', label: 'independent island', degree: 1 },
    ];
    const edges = [
      { source: 'main', target: 'related' },
      { source: 'missing', target: 'island' },
    ];
    const positions = layoutContributionGraph(nodes, edges);
    const byId = new Map(positions.map((position) => [position.id, position]));
    expect(positions).toHaveLength(nodes.length);
    expect(byId.get('main')).toMatchObject({ x: 0, y: 0 });
    expect(Math.hypot(byId.get('related')?.x ?? 0, byId.get('related')?.y ?? 0)).toBe(
      Math.hypot(byId.get('island')?.x ?? 0, byId.get('island')?.y ?? 0),
    );
    expect(layoutContributionGraph(nodes, edges)).toEqual(positions);
  });
});
