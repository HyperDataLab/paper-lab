export type ContributionLayoutNode = { id: string; label: string; degree: number; stage?: number };
export type ContributionLayoutEdge = { source: string; target: string };
export type ContributionLabelSide = 'top' | 'right' | 'bottom' | 'left';
export type ContributionPosition = {
  id: string;
  x: number;
  y: number;
  angle: number;
  labelSide: ContributionLabelSide;
  labelX: number;
  labelY: number;
  labelWidth: number;
  labelHeight: number;
  width: number;
  height: number;
  dotX: number;
  dotY: number;
  dotDiameter: number;
};

const NODE_DIAMETER = 48;
const CENTRE_DIAMETER = 68;
const LABEL_MAX_WIDTH = 144;
const LABEL_LINE_HEIGHT = 20;
const LABEL_NODE_GAP = 12;
const NODE_GAP = 16;
const MIN_RING_RADIUS = 168;

type NodeFootprint = Omit<ContributionPosition, 'id' | 'x' | 'y' | 'angle'>;

function estimateTextWidth(text: string): number {
  return [...text].reduce((width, character) => {
    if (/\s/.test(character)) return width + 4;
    if (/[ilI.,'`!|:;]/.test(character)) return width + 4;
    if (/[MW@%&]/.test(character)) return width + 10;
    if (/[A-Z0-9]/.test(character)) return width + 8;
    return width + 7.2;
  }, 0);
}

function wrappedLabelWidth(label: string): { width: number; lines: number } {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { width: NODE_DIAMETER, lines: 1 };

  let lines = 1;
  let currentLine = '';
  let widest = 0;
  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (currentLine && estimateTextWidth(candidate) > LABEL_MAX_WIDTH) {
      widest = Math.max(widest, estimateTextWidth(currentLine));
      lines += 1;
      currentLine = word;
    } else {
      currentLine = candidate;
    }
  }
  widest = Math.max(widest, estimateTextWidth(currentLine));
  if (words.some((word) => estimateTextWidth(word) > LABEL_MAX_WIDTH)) lines = Math.max(lines, 2);
  return { width: Math.min(LABEL_MAX_WIDTH, Math.max(NODE_DIAMETER, widest)), lines: Math.min(lines, 2) };
}

function labelSideForAngle(angle: number): ContributionLabelSide {
  const horizontal = Math.cos(angle);
  const vertical = Math.sin(angle);
  if (Math.abs(vertical) >= Math.abs(horizontal)) return vertical >= 0 ? 'bottom' : 'top';
  return horizontal >= 0 ? 'right' : 'left';
}

function footprintFor(
  label: string,
  side: ContributionLabelSide,
  dotDiameter = NODE_DIAMETER,
): NodeFootprint {
  const measured = wrappedLabelWidth(label);
  const labelWidth = measured.width;
  const labelHeight = measured.lines * LABEL_LINE_HEIGHT;
  if (side === 'top' || side === 'bottom') {
    const width = Math.max(dotDiameter, labelWidth);
    const height = dotDiameter + LABEL_NODE_GAP + labelHeight;
    const dotX = width / 2;
    const dotY = side === 'top' ? height - dotDiameter / 2 : dotDiameter / 2;
    return {
      labelSide: side,
      labelX: (width - labelWidth) / 2,
      labelY: side === 'top' ? 0 : NODE_DIAMETER + LABEL_NODE_GAP,
      labelWidth,
      labelHeight,
      width,
      height,
      dotX,
      dotY,
      dotDiameter,
    };
  }

  const width = dotDiameter + LABEL_NODE_GAP + labelWidth;
  const height = Math.max(dotDiameter, labelHeight);
  const dotX = side === 'left' ? width - dotDiameter / 2 : dotDiameter / 2;
  const dotY = height / 2;
  return {
    labelSide: side,
    labelX: side === 'left' ? 0 : dotDiameter + LABEL_NODE_GAP,
    labelY: (height - labelHeight) / 2,
    labelWidth,
    labelHeight,
    width,
    height,
    dotX,
    dotY,
    dotDiameter,
  };
}

function tangentHalfExtent(footprint: NodeFootprint, angle: number): number {
  const tangentX = -Math.sin(angle);
  const tangentY = Math.cos(angle);
  const labelCenterX = footprint.labelX + footprint.labelWidth / 2 - footprint.dotX;
  const labelCenterY = footprint.labelY + footprint.labelHeight / 2 - footprint.dotY;
  const labelHalfExtent =
    (Math.abs(tangentX) * footprint.labelWidth) / 2 + (Math.abs(tangentY) * footprint.labelHeight) / 2;
  const labelOffset = Math.abs(tangentX * labelCenterX + tangentY * labelCenterY);
  return Math.max(footprint.dotDiameter / 2, labelHalfExtent + labelOffset);
}

function arrangeAngles(nodes: ContributionLayoutNode[]) {
  if (nodes.length === 0)
    return { angles: [] as number[], footprints: [] as NodeFootprint[], radius: MIN_RING_RADIUS };
  let angles = nodes.map((_, index) => -Math.PI / 2 + (2 * Math.PI * index) / nodes.length);
  let footprints: NodeFootprint[] = [];
  let angularGaps: number[] = [];

  for (let iteration = 0; iteration < 6; iteration += 1) {
    footprints = nodes.map((node, index) =>
      footprintFor(node.label, labelSideForAngle(angles[index] ?? -Math.PI / 2)),
    );
    const requirements = footprints.map((footprint, index) => {
      const next = footprints[(index + 1) % footprints.length];
      const angle = angles[index] ?? -Math.PI / 2;
      const nextAngle = angles[(index + 1) % angles.length] ?? angle;
      if (!next) return NODE_GAP;
      return tangentHalfExtent(footprint, angle) + tangentHalfExtent(next, nextAngle) + NODE_GAP;
    });
    const total = requirements.reduce((sum, requirement) => sum + requirement, 0);
    angularGaps = requirements.map((requirement) => (total > 0 ? (2 * Math.PI * requirement) / total : 0));
    angles = nodes.map((_, index) => {
      const precedingGaps = angularGaps.slice(0, index).reduce((sum, gap) => sum + gap, 0);
      return -Math.PI / 2 + precedingGaps;
    });
  }

  footprints = nodes.map((node, index) =>
    footprintFor(node.label, labelSideForAngle(angles[index] ?? -Math.PI / 2)),
  );
  const requirements = footprints.map((footprint, index) => {
    const next = footprints[(index + 1) % footprints.length];
    if (!next) return NODE_GAP;
    return (
      tangentHalfExtent(footprint, angles[index] ?? 0) +
      tangentHalfExtent(next, angles[(index + 1) % angles.length] ?? 0) +
      NODE_GAP
    );
  });
  const requiredRadius = requirements.reduce((largest, requirement, index) => {
    const currentAngle = angles[index] ?? 0;
    const nextAngle = angles[(index + 1) % angles.length] ?? currentAngle;
    const gap = (nextAngle - currentAngle + 2 * Math.PI) % (2 * Math.PI);
    const chordFactor = 2 * Math.sin(gap / 2);
    return Math.max(largest, chordFactor > 0 ? requirement / chordFactor : MIN_RING_RADIUS);
  }, MIN_RING_RADIUS);
  const radius = requiredRadius * 1.08;
  return { angles, footprints, radius };
}

export function layoutContributionGraph(
  nodes: ContributionLayoutNode[],
  _edges: ContributionLayoutEdge[],
): ContributionPosition[] {
  if (nodes.length === 0) return [];
  const [center, ...rest] = [...nodes].sort(
    (a, b) => b.degree - a.degree || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
  );
  if (!center) return [];

  const stageRings: ContributionLayoutNode[][] = [[], [], []];
  for (const node of rest) {
    const ringIndex = node.stage === 0 ? 0 : node.stage === 3 ? 2 : 1;
    stageRings[ringIndex]?.push(node);
  }
  const rings = stageRings.filter((ring) => ring.length > 0);
  let previousRadius = CENTRE_DIAMETER / 2 + 30;
  const placed = rings.flatMap((ring, ringIndex) => {
    const ordered = [...ring].sort(
      (a, b) => (a.stage ?? 1) - (b.stage ?? 1) || b.degree - a.degree || a.id.localeCompare(b.id),
    );
    const { angles, footprints, radius: spacingRadius } = arrangeAngles(ordered);
    const radius = Math.max(168 + ringIndex * 128, previousRadius + 128, spacingRadius);
    previousRadius = radius;
    return ordered.map((node, index) => {
      const angle = (angles[index] ?? -Math.PI / 2) + ringIndex * 0.18;
      const footprint = footprints[index] ?? footprintFor(node.label, labelSideForAngle(angle));
      return {
        id: node.id,
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        angle,
        ...footprint,
      };
    });
  });

  return [
    {
      id: center.id,
      x: 0,
      y: 0,
      angle: 0,
      ...footprintFor(center.label, 'bottom', CENTRE_DIAMETER),
    },
    ...placed,
  ];
}
