import type { Argument } from '../schemas';
import type { ArgumentNode, ArgumentEdge } from './index';

/**
 * Geometry for drawing one argument as a diagram. The layout is computed, not dragged: the same argument
 * always draws the same way, and the screen only has to render boxes and lines.
 */
type Span = Argument['claim'];
export type DiagramRole =
  | 'claim'
  | 'data'
  | 'warrant'
  | 'backing'
  | 'qualifier'
  | 'rebuttal'
  | 'premise'
  | 'conclusion'
  | 'ra'
  | 'ca';
export interface DiagramNode {
  id: string;
  role: DiagramRole;
  /** `statement` is a passage of the paper (an I-node in AIF); `scheme` is an inference or conflict step. */
  kind: 'statement' | 'scheme';
  /** The quoted words; null for a scheme node and for a slot nothing was found for. */
  text: string | null;
  /** Where the words are in the paper. Never set for a scheme node or for a warrant the model inferred. */
  span: Span | null;
  /** True for a warrant the model inferred: it is not the author's and has no place in the paper. */
  inferred: boolean;
  /** True for a Toulmin slot with nothing behind it; the screen says so and shows no invented text. */
  missing: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  /** A conflict or a limit is drawn dashed, so the relation does not rest on colour. */
  dashed: boolean;
  tone: 'support' | 'limit' | 'conflict';
}
export interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  width: number;
  height: number;
  /** For Toulmin: how many of the six components were identified. */
  identified: number;
}

export const CARD = { width: 270, height: 124, gapX: 72, gapY: 28 };
const SCHEME = 132;
const column = (index: number) => index * (CARD.width + CARD.gapX);
const row = (index: number) => index * (CARD.height + CARD.gapY);

function statement(
  id: string,
  role: DiagramRole,
  span: Span | null,
  x: number,
  y: number,
  extra: Partial<DiagramNode> = {},
): DiagramNode {
  return {
    id,
    role,
    kind: 'statement',
    text: span?.excerpt ?? null,
    span,
    inferred: false,
    missing: span === null,
    x,
    y,
    width: CARD.width,
    height: CARD.height,
    ...extra,
  };
}
const size = (nodes: DiagramNode[]) => ({
  width: Math.max(...nodes.map((node) => node.x + node.width)),
  height: Math.max(...nodes.map((node) => node.y + node.height)),
});

/**
 * Toulmin: data on the left support the claim on the right; the qualifier sits above the link, the warrant
 * and its backing below it, rebuttals under the claim. A slot with nothing behind it is drawn as missing.
 */
export function toulminDiagram(argument: Argument, orientation: Orientation = 'horizontal'): Diagram {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const link = (from: string, to: string, label: string, tone: DiagramEdge['tone'] = 'support') =>
    edges.push({ id: `${from}>${to}`, from, to, label, dashed: tone !== 'support', tone });

  nodes.push(statement('qualifier', 'qualifier', argument.qualifier, column(1), row(0)));
  const data: (Span | null)[] = argument.data.length ? argument.data : [null];
  data.forEach((span, index) =>
    nodes.push(statement(`data-${index}`, 'data', span, column(0), row(1 + index))),
  );
  nodes.push(statement('claim', 'claim', argument.claim, column(2), row(1)));

  const warrantRow = 1 + data.length;
  nodes.push(
    argument.statedWarrant
      ? statement('warrant', 'warrant', argument.statedWarrant, column(1), row(warrantRow))
      : statement('warrant', 'warrant', null, column(1), row(warrantRow), {
          text: argument.inferredWarrant,
          inferred: argument.inferredWarrant !== null,
          missing: argument.inferredWarrant === null,
        }),
  );
  const backing: (Span | null)[] = argument.backing.length ? argument.backing : [null];
  backing.forEach((span, index) =>
    nodes.push(statement(`backing-${index}`, 'backing', span, column(1), row(warrantRow + 1 + index))),
  );
  const rebuttals: (Span | null)[] = argument.rebuttals.length ? argument.rebuttals : [null];
  rebuttals.forEach((span, index) =>
    nodes.push(statement(`rebuttal-${index}`, 'rebuttal', span, column(2), row(2 + index))),
  );

  // Only what was identified is connected; a missing slot stands alone.
  argument.data.forEach((_, index) => link(`data-${index}`, 'claim', 'Làm căn cứ cho'));
  if (argument.qualifier) link('qualifier', 'claim', 'Giới hạn', 'limit');
  if (argument.statedWarrant || argument.inferredWarrant) link('warrant', 'claim', 'Lý lẽ nối');
  argument.backing.forEach((_, index) => link(`backing-${index}`, 'warrant', 'Hậu thuẫn cho'));
  argument.rebuttals.forEach((_, index) => link(`rebuttal-${index}`, 'claim', 'Trừ khi', 'conflict'));

  const identified = [
    true,
    argument.data.length > 0,
    Boolean(argument.statedWarrant || argument.inferredWarrant),
    argument.backing.length > 0,
    Boolean(argument.qualifier),
    argument.rebuttals.length > 0,
  ].filter(Boolean).length;
  if (orientation === 'vertical') verticalToulmin(nodes);
  return { nodes, edges, ...size(nodes), identified };
}

/**
 * AIF: statements never touch directly. Premises reach the conclusion through an RA node, and a rebuttal
 * through a CA node; the scheme nodes carry no passage of the paper.
 */
export function aifDiagram(argument: Argument, orientation: Orientation = 'horizontal'): Diagram {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const premises = [
    ...argument.data,
    ...(argument.statedWarrant ? [argument.statedWarrant] : []),
    ...argument.backing,
  ];
  const rows = Math.max(premises.length, 1) + argument.rebuttals.length;
  const middle = (first: number, count: number) =>
    row(first) + (row(count - 1) + CARD.height) / 2 - SCHEME / 2;
  const scheme = (id: string, role: 'ra' | 'ca', first: number, count: number): DiagramNode => ({
    id,
    role,
    kind: 'scheme',
    text: null,
    span: null,
    inferred: false,
    missing: false,
    x: column(1) + (CARD.width - SCHEME) / 2,
    y: middle(first, count),
    width: SCHEME,
    height: SCHEME,
  });
  const conclusionY = row(0) + (row(rows - 1) + CARD.height) / 2 - CARD.height / 2;
  nodes.push(statement('conclusion', 'conclusion', argument.claim, column(2), conclusionY));

  if (premises.length > 0) {
    premises.forEach((span, index) => {
      nodes.push(statement(`premise-${index}`, 'premise', span, column(0), row(index)));
      edges.push({
        id: `premise-${index}>ra`,
        from: `premise-${index}`,
        to: 'ra',
        label: '',
        dashed: false,
        tone: 'support',
      });
    });
    nodes.push(scheme('ra', 'ra', 0, premises.length));
    edges.push({
      id: 'ra>conclusion',
      from: 'ra',
      to: 'conclusion',
      label: 'Suy ra',
      dashed: false,
      tone: 'support',
    });
  }
  const firstRebuttal = Math.max(premises.length, 1);
  argument.rebuttals.forEach((span, index) => {
    const at = firstRebuttal + index;
    nodes.push(statement(`rebuttal-${index}`, 'rebuttal', span, column(0), row(at)));
    nodes.push(scheme(`ca-${index}`, 'ca', at, 1));
    edges.push({
      id: `rebuttal-${index}>ca-${index}`,
      from: `rebuttal-${index}`,
      to: `ca-${index}`,
      label: '',
      dashed: true,
      tone: 'conflict',
    });
    edges.push({
      id: `ca-${index}>conclusion`,
      from: `ca-${index}`,
      to: 'conclusion',
      label: 'Phản bác',
      dashed: true,
      tone: 'conflict',
    });
  });
  if (orientation === 'vertical') verticalAif(nodes);
  return { nodes, edges, ...size(nodes), identified: 0 };
}

/** An elbow path from the right or bottom of one node to the left or top of another. */
export function edgePath(
  from: DiagramNode,
  to: DiagramNode,
  obstacles?: DiagramNode[],
): { d: string; labelX: number; labelY: number } {
  if (obstacles) return routeEdge(from, to, obstacles);
  const sameColumn = Math.abs(from.x + from.width / 2 - (to.x + to.width / 2)) < 1;
  if (sameColumn) {
    const x = from.x + from.width / 2;
    const up = to.y < from.y;
    const startY = up ? from.y : from.y + from.height;
    const endY = up ? to.y + to.height : to.y;
    return { d: `M ${x} ${startY} V ${endY}`, labelX: x, labelY: (startY + endY) / 2 };
  }
  const forward = to.x > from.x;
  const startX = forward ? from.x + from.width : from.x;
  const endX = forward ? to.x : to.x + to.width;
  const startY = from.y + from.height / 2;
  const endY = to.y + to.height / 2;
  const midX = (startX + endX) / 2;
  return {
    d: `M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`,
    labelX: midX,
    labelY: (startY + endY) / 2,
  };
}

export type Orientation = 'horizontal' | 'vertical';

function verticalToulmin(nodes: DiagramNode[]) {
  nodes.forEach((node) => {
    node.width = 200;
  });
  const data = nodes.filter((n) => n.role === 'data');
  const backing = nodes.filter((n) => n.role === 'backing');
  const rebuttals = nodes.filter((n) => n.role === 'rebuttal');
  for (const node of nodes) {
    if (node.role === 'qualifier') {
      node.x = column(0);
      node.y = row(0);
    }
    if (node.role === 'data') {
      node.x = column(0);
      node.y = row(1 + data.indexOf(node));
    }
    if (node.role === 'claim') {
      node.x = column(0);
      node.y = row(1 + data.length);
    }
    if (node.role === 'warrant') {
      node.x = 240;
      node.y = row(1 + data.length);
    }
    if (node.role === 'backing') {
      node.x = 240;
      node.y = row(2 + data.length + backing.indexOf(node));
    }
    if (node.role === 'rebuttal') {
      node.x = column(0);
      node.y = row(2 + data.length + rebuttals.indexOf(node));
    }
  }
}

function verticalAif(nodes: DiagramNode[]) {
  nodes
    .filter((node) => node.kind === 'statement')
    .forEach((node) => {
      node.width = 200;
    });
  const premises = nodes.filter((n) => n.role === 'premise');
  const rebuttals = nodes.filter((n) => n.role === 'rebuttal');
  for (const node of nodes) {
    if (node.role === 'premise') {
      node.x = 0;
      node.y = row(premises.indexOf(node));
    }
    if (node.role === 'ra') {
      node.x = (200 - node.width) / 2;
      node.y = row(premises.length);
    }
    if (node.role === 'conclusion') {
      node.x = 0;
      node.y = row(premises.length + 1);
    }
    if (node.role === 'rebuttal') {
      node.x = 240;
      node.y = row(rebuttals.indexOf(node) * 2);
    }
    if (node.role === 'ca') {
      node.x = 240 + (200 - node.width) / 2;
      node.y = row(rebuttals.findIndex((n) => n.id.replace('rebuttal-', 'ca-') === node.id) * 2 + 1);
    }
  }
}

/** Layer the graph by dependency; cycles are kept in a bounded set of layers. */
export function paperDiagram(
  graph: { nodes: ArgumentNode[]; edges: ArgumentEdge[] },
  conflictsOnly = false,
): Diagram {
  const ca = new Set(graph.nodes.filter((n) => n.kind === 'CA').map((n) => n.id));
  const edges = conflictsOnly ? graph.edges.filter((e) => ca.has(e.from) || ca.has(e.to)) : graph.edges;
  const included = new Set(edges.flatMap((e) => [e.from, e.to]));
  const source = conflictsOnly ? graph.nodes.filter((n) => included.has(n.id)) : graph.nodes;
  const layers = new Map(source.map((n) => [n.id, 0]));
  // Relax only acyclic dependencies; a back edge remains visible without unbounded growth.
  const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return edges.some((e) => e.from === from && reaches(e.to, target, seen));
  };
  for (let i = 0; i < source.length; i++)
    for (const edge of edges) {
      if (reaches(edge.to, edge.from)) continue;
      layers.set(edge.to, Math.max(layers.get(edge.to) ?? 0, (layers.get(edge.from) ?? 0) + 1));
    }
  const counts = new Map<number, number>();
  const nodes = source.map((n): DiagramNode => {
    const layer = layers.get(n.id) ?? 0;
    const position = counts.get(layer) ?? 0;
    counts.set(layer, position + 1);
    if (n.kind === 'I') return statement(n.id, 'premise', n.span, column(layer), row(position));
    return {
      id: n.id,
      role: n.kind === 'RA' ? 'ra' : 'ca',
      kind: 'scheme',
      text: null,
      span: null,
      inferred: false,
      missing: false,
      x: column(layer),
      y: row(position),
      width: SCHEME,
      height: SCHEME,
    };
  });
  const renderedEdges: DiagramEdge[] = edges.map((e, i) => {
    const conflict = ca.has(e.from) || ca.has(e.to);
    return {
      ...e,
      id: `${e.from}>${e.to}-${i}`,
      label: ca.has(e.from) ? 'Phản bác' : '',
      dashed: conflict,
      tone: conflict ? 'conflict' : 'support',
    };
  });
  return {
    nodes,
    edges: renderedEdges,
    width: nodes.length ? size(nodes).width : 0,
    height: nodes.length ? size(nodes).height : 0,
    identified: 0,
  };
}

function routeEdge(from: DiagramNode, to: DiagramNode, nodes: DiagramNode[]) {
  const ports = (n: DiagramNode) => [
    { x: n.x, y: n.y + n.height / 2 },
    { x: n.x + n.width, y: n.y + n.height / 2 },
    { x: n.x + n.width / 2, y: n.y },
    { x: n.x + n.width / 2, y: n.y + n.height },
  ];
  const starts = ports(from),
    ends = ports(to);
  const all = [...nodes];
  const xs = [
    ...new Set(
      [...starts, ...ends].map((p) => p.x).concat(all.flatMap((n) => [n.x - 12, n.x + n.width + 12])),
    ),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set(
      [...starts, ...ends].map((p) => p.y).concat(all.flatMap((n) => [n.y - 12, n.y + n.height + 12])),
    ),
  ].sort((a, b) => a - b);
  const blocked = (x1: number, y1: number, x2: number, y2: number) =>
    nodes.some((n) =>
      x1 === x2
        ? x1 > n.x && x1 < n.x + n.width && Math.max(y1, y2) > n.y && Math.min(y1, y2) < n.y + n.height
        : y1 > n.y && y1 < n.y + n.height && Math.max(x1, x2) > n.x && Math.min(x1, x2) < n.x + n.width,
    );
  const key = (x: number, y: number) => `${x},${y}`;
  const dist = new Map<string, number>(),
    previous = new Map<string, string>();
  const queue: { x: number; y: number; cost: number }[] = [];
  for (const p of starts) {
    dist.set(key(p.x, p.y), 0);
    queue.push({ ...p, cost: 0 });
  }
  const targets = new Set(ends.map((p) => key(p.x, p.y)));
  let finish = '';
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    if (!current) break;
    const id = key(current.x, current.y);
    if (current.cost !== dist.get(id)) continue;
    if (targets.has(id)) {
      finish = id;
      break;
    }
    const xi = xs.indexOf(current.x),
      yi = ys.indexOf(current.y);
    const neighbours = [
      [xs[xi - 1], current.y],
      [xs[xi + 1], current.y],
      [current.x, ys[yi - 1]],
      [current.x, ys[yi + 1]],
    ];
    for (const [x, y] of neighbours) {
      if (x === undefined || y === undefined || blocked(current.x, current.y, x, y)) continue;
      const next = key(x, y),
        cost = current.cost + Math.abs(x - current.x) + Math.abs(y - current.y);
      if (cost < (dist.get(next) ?? Infinity)) {
        dist.set(next, cost);
        previous.set(next, id);
        queue.push({ x, y, cost });
      }
    }
  }
  if (!finish) return edgePath(from, to);
  const points: string[] = [];
  for (let at: string | undefined = finish; at; at = previous.get(at)) points.unshift(at);
  const coordinates = points.map((p) => p.split(',').map(Number));
  const first = coordinates[0] ?? [0, 0];
  const d =
    `M ${first[0]} ${first[1]}` +
    coordinates
      .slice(1)
      .map((p, i) => (p[0] === coordinates[i]?.[0] ? ` V ${p[1]}` : ` H ${p[0]}`))
      .join('');
  const middle = coordinates[Math.floor(coordinates.length / 2)] ?? first;
  return { d, labelX: middle[0] ?? 0, labelY: middle[1] ?? 0 };
}
