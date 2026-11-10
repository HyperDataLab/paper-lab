import { expect, it } from 'vitest';
import type { Argument } from '../schemas';
import { aifDiagram, edgePath, paperDiagram, toulminDiagram } from './diagram';
import { buildArgumentGraph } from './index';

const span = (excerpt: string) => ({
  paragraphId: 'p1',
  sectionId: 's',
  page: 1,
  start: 0,
  end: excerpt.length,
  excerpt,
});
const full: Argument = {
  id: 'a1',
  importance: 'main',
  claim: span('X improves Y.'),
  data: [span('Y rose 12%.'), span('Z fell.')],
  statedWarrant: span('A rise in Y reflects X.'),
  inferredWarrant: null,
  backing: [span('Prior work shows this.')],
  qualifier: span('in most cases'),
  rebuttals: [span('unless Z')],
};
const bare: Argument = {
  ...full,
  data: [],
  statedWarrant: null,
  inferredWarrant: 'Higher is better.',
  backing: [],
  qualifier: null,
  rebuttals: [],
};

it('R4 Toulmin: every component is a node, and only identified components are connected to the claim', () => {
  const diagram = toulminDiagram(full);
  expect(diagram.identified).toBe(6);
  expect(diagram.nodes.map((node) => node.role).sort()).toEqual(
    ['backing', 'claim', 'data', 'data', 'qualifier', 'rebuttal', 'warrant'].sort(),
  );
  expect(diagram.edges.map((edge) => `${edge.from}>${edge.to}`).sort()).toEqual(
    [
      'backing-0>warrant',
      'data-0>claim',
      'data-1>claim',
      'qualifier>claim',
      'rebuttal-0>claim',
      'warrant>claim',
    ].sort(),
  );
  // A limit and a rebuttal are dashed, so the relation does not rest on colour.
  expect(
    diagram.edges
      .filter((edge) => edge.dashed)
      .map((edge) => edge.from)
      .sort(),
  ).toEqual(['qualifier', 'rebuttal-0']);
  // No two nodes overlap.
  for (const a of diagram.nodes)
    for (const b of diagram.nodes)
      if (a.id < b.id)
        expect(
          a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
        ).toBe(true);
});

it("R4 Toulmin: an empty slot is drawn as missing with no invented text, and an inferred warrant is never the author's", () => {
  const diagram = toulminDiagram(bare);
  expect(diagram.identified).toBe(2);
  const node = (id: string) => diagram.nodes.find((item) => item.id === id);
  for (const id of ['data-0', 'backing-0', 'qualifier', 'rebuttal-0'])
    expect(node(id)).toMatchObject({ missing: true, text: null, span: null });
  expect(node('warrant')).toMatchObject({
    inferred: true,
    missing: false,
    span: null,
    text: 'Higher is better.',
  });
  // A missing slot is not connected to anything.
  expect(diagram.edges.map((edge) => edge.from)).toEqual(['warrant']);
});

it('R4 AIF: a premise reaches the conclusion only through an RA node, a rebuttal only through a CA node', () => {
  const diagram = aifDiagram(full);
  const kind = (id: string) => diagram.nodes.find((node) => node.id === id)?.kind;
  // No edge joins two statements directly.
  for (const edge of diagram.edges)
    expect(kind(edge.from) === 'statement' && kind(edge.to) === 'statement').toBe(false);
  // Scheme nodes carry no passage of the paper.
  for (const node of diagram.nodes.filter((item) => item.kind === 'scheme'))
    expect(node).toMatchObject({ span: null, text: null });
  expect(diagram.nodes.filter((node) => node.role === 'premise')).toHaveLength(4);
  expect(diagram.edges.filter((edge) => edge.to === 'ra')).toHaveLength(4);
  expect(diagram.edges.map((edge) => `${edge.from}>${edge.to}`)).toEqual(
    expect.arrayContaining(['ra>conclusion', 'rebuttal-0>ca-0', 'ca-0>conclusion']),
  );
});

it('R4 AIF: an inferred warrant is not a premise, and a claim with no premise has no RA node', () => {
  const diagram = aifDiagram(bare);
  expect(diagram.nodes.map((node) => node.id)).toEqual(['conclusion']);
  expect(diagram.edges).toEqual([]);
});

it('R4 edges are elbow paths between the facing sides of two nodes', () => {
  const diagram = toulminDiagram(full);
  const node = (id: string) => diagram.nodes.find((item) => item.id === id);
  const data = node('data-0');
  const claim = node('claim');
  const warrant = node('warrant');
  const backing = node('backing-0');
  if (!data || !claim || !warrant || !backing) throw new Error('missing node');
  expect(edgePath(data, claim).d).toMatch(/^M \d+ \d+ H [\d.]+ V [\d.]+ H \d+$/);
  // Same column: a straight vertical line from the lower node up to the one above.
  expect(edgePath(backing, warrant).d).toBe(
    `M ${backing.x + backing.width / 2} ${backing.y} V ${warrant.y + warrant.height}`,
  );
});

it('R5 routed edges avoid the interiors of other cards in both orientations', () => {
  for (const orientation of ['horizontal', 'vertical'] as const) {
    for (let count = 1; count <= 5; count++) {
      const argument = {
        ...full,
        data: Array.from({ length: count }, (_, i) => span(`data ${i}`)),
        rebuttals: [span('first'), span('second')],
      };
      for (const diagram of [toulminDiagram(argument, orientation), aifDiagram(argument, orientation)]) {
        for (const edge of diagram.edges) {
          const from = diagram.nodes.find((node) => node.id === edge.from);
          const to = diagram.nodes.find((node) => node.id === edge.to);
          if (!from || !to) throw new Error('missing endpoint');
          const tokens = edgePath(from, to, diagram.nodes).d.split(' ');
          let x = Number(tokens[1]),
            y = Number(tokens[2]);
          for (let i = 3; i < tokens.length; i += 2) {
            const nextX = tokens[i] === 'H' ? Number(tokens[i + 1]) : x;
            const nextY = tokens[i] === 'V' ? Number(tokens[i + 1]) : y;
            for (const node of diagram.nodes.filter((n) => n !== from && n !== to)) {
              const crosses =
                x === nextX
                  ? x > node.x &&
                    x < node.x + node.width &&
                    Math.max(y, nextY) > node.y &&
                    Math.min(y, nextY) < node.y + node.height
                  : y > node.y &&
                    y < node.y + node.height &&
                    Math.max(x, nextX) > node.x &&
                    Math.min(x, nextX) < node.x + node.width;
              expect(crosses).toBe(false);
            }
            x = nextX;
            y = nextY;
          }
        }
      }
    }
  }
});

it('R5 whole-paper layers shared statements and filters conflicts', () => {
  const second = { ...full, id: 'a2', claim: { ...span('next'), paragraphId: 'p2' }, data: [full.claim] };
  const graph = buildArgumentGraph([full, second]);
  const diagram = paperDiagram(graph);
  const shared = diagram.nodes.find((node) => node.span?.excerpt === full.claim.excerpt);
  const conclusion = diagram.nodes.find((node) => node.span?.excerpt === 'next');
  expect(shared && conclusion && conclusion.x > shared.x).toBe(true);
  const conflicts = paperDiagram(graph, true);
  expect(conflicts.nodes.some((node) => node.role === 'ca')).toBe(true);
  expect(conflicts.nodes.some((node) => node.role === 'ra')).toBe(false);
  expect(conflicts.edges.every((edge) => edge.dashed)).toBe(true);
});
