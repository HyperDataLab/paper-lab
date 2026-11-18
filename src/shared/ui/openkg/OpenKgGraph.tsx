import { KG_LAYERS, type KgEdge, type KgNode, type PaperKg } from '@/core/openkg';
import { edgeKey } from './labels';
import styles from './openkg.module.css';

const SIZE = 640;
const CENTRE = SIZE / 2;
const CORPUS_RINGS = [
  { layer: 'disciplinary', radius: 56 },
  { layer: 'normative', radius: 103 },
  { layer: 'conceptual', radius: 153 },
  { layer: 'evidential', radius: 215 },
  { layer: 'expertise', radius: 278 },
] as const;

export function OpenKgGraph({
  graph,
  selected,
  onSelect,
  layout = 'paper',
}: {
  graph: PaperKg;
  selected?: string;
  onSelect: (id: string) => void;
  layout?: 'paper' | 'corpus';
}) {
  const article = layout === 'paper' ? graph.nodes.find((node) => node.type === 'Paper') : undefined;
  const rings = (
    layout === 'corpus'
      ? CORPUS_RINGS
      : KG_LAYERS.map((layer, index) => ({ layer, radius: 270 - index * 48 }))
  ).map((ring) => ({
    ...ring,
    nodes: graph.nodes.filter((node) => node.layer === ring.layer && node.id !== article?.id),
  }));
  const points = new Map<string, { node: KgNode; x: number; y: number; r: number }>();
  if (article) points.set(article.id, { node: article, x: CENTRE, y: CENTRE, r: 34 });
  for (const ring of rings) {
    const spacing = (2 * Math.PI * ring.radius) / ring.nodes.length;
    ring.nodes.forEach((node, index) => {
      const angle = (2 * Math.PI * index) / ring.nodes.length - Math.PI / 2;
      points.set(node.id, {
        node,
        x: CENTRE + ring.radius * Math.cos(angle),
        y: CENTRE + ring.radius * Math.sin(angle),
        r: Math.max(3, Math.min(10, spacing / 3)),
      });
    });
  }
  function line(edge: KgEdge) {
    const start = points.get(edge.s);
    const end = points.get(edge.o);
    if (!start || !end) return null;
    return (
      <line
        key={edgeKey(edge)}
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        className={styles.edge}
        data-active={edge.s === selected || edge.o === selected}
        data-layer={edge.layer}
      />
    );
  }
  return (
    <svg
      className={styles.graph}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="group"
      aria-label={layout === 'paper' ? 'Đồ thị tri thức của bài báo' : 'Đồ thị tri thức của corpus'}
    >
      <g aria-hidden="true">
        {rings.map(
          ({ layer, radius, nodes }) =>
            nodes.length > 0 && (
              <circle key={layer} className={styles.ring} cx={CENTRE} cy={CENTRE} r={radius} />
            ),
        )}
        {graph.edges.map(line)}
      </g>
      {[...points.values()].map(({ node, x, y, r }) => (
        <g
          key={node.id}
          role="button"
          tabIndex={0}
          aria-label={node.label}
          aria-pressed={selected === node.id}
          className={styles.node}
          data-layer={node.layer}
          data-paper={node.type === 'Paper'}
          onClick={() => onSelect(node.id)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onSelect(node.id);
          }}
        >
          <title>{node.label}</title>
          <circle cx={x} cy={y} r={r} />
          {node.id === article?.id && (
            <text x={x} y={y} textAnchor="middle" dominantBaseline="central">
              Bài báo
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
