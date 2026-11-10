import type { Argument } from '../schemas';

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
export function toulminDiagram(argument: Argument): Diagram {
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
  return { nodes, edges, ...size(nodes), identified };
}

/**
 * AIF: statements never touch directly. Premises reach the conclusion through an RA node, and a rebuttal
 * through a CA node; the scheme nodes carry no passage of the paper.
 */
export function aifDiagram(argument: Argument): Diagram {
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
  return { nodes, edges, ...size(nodes), identified: 0 };
}

/** An elbow path from the right or bottom of one node to the left or top of another. */
export function edgePath(from: DiagramNode, to: DiagramNode): { d: string; labelX: number; labelY: number } {
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
