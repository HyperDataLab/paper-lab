import { KG_LAYERS, type KgEdge, type KgNode, type PaperKg } from '@/core/openkg';
import { edgeKey } from './openkgLabels';
import styles from './openkg.module.css';

const SIZE = 640;
const CENTRE = SIZE / 2;

export function OpenKgGraph({
  graph,
  selected,
  onSelect,
}: {
  graph: PaperKg;
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const article = graph.nodes.find((node) => node.type === 'Paper');
  const rings = KG_LAYERS.map((layer, index) => ({
    layer,
    radius: 270 - index * 48,
    nodes: graph.nodes.filter((node) => node.layer === layer && node.type !== 'Paper'),
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
      aria-label="Đồ thị tri thức của bài báo"
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
          {node.type === 'Paper' && (
            <text x={x} y={y} textAnchor="middle" dominantBaseline="central">
              Bài báo
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
