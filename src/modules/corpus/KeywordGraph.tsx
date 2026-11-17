import { GRAPH_SIZE, keywordGraph, type KeywordAggregate } from '@/core/corpusKeywords';
import styles from './keywords.module.css';

const TOP = 40;
const MIN_STRENGTH = 0.1;

export function KeywordGraph({
  aggregate,
  selected,
  onSelect,
}: {
  aggregate: Pick<KeywordAggregate, 'keywords' | 'pairs'>;
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  const { nodes, edges } = keywordGraph(aggregate, { top: TOP, minStrength: MIN_STRENGTH });
  const at = new Map(nodes.map((node) => [node.id, node]));
  return (
    <>
      <p className={styles.muted}>
        {nodes.length} keyword nhiều bài nhất; nối hai keyword khi cùng xuất hiện trong ít nhất 2 bài với độ
        mạnh Jaccard từ {MIN_STRENGTH} ({edges.length} cạnh). Nét càng dày, hai keyword càng hay đi cùng nhau.
      </p>
      <svg
        className={styles.graph}
        viewBox={`0 0 ${GRAPH_SIZE} ${GRAPH_SIZE}`}
        role="group"
        aria-label={`Đồ thị đồng xuất hiện của ${nodes.length} keyword và ${edges.length} cạnh. Chọn một keyword để xem các bài của nó; bảng bên dưới có cùng số liệu.`}
      >
        {edges.map((edge) => {
          const from = at.get(edge.a);
          const to = at.get(edge.b);
          if (!from || !to) return null;
          const active = selected === edge.a || selected === edge.b;
          return (
            <line
              key={`${edge.a}|${edge.b}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className={active ? styles.edgeActive : styles.edge}
              strokeWidth={1 + 5 * edge.strength}
              strokeOpacity={selected && !active ? 0.15 : 0.35 + 0.65 * edge.strength}
            >
              <title>{`${from.name} – ${to.name}: ${edge.count} bài, độ mạnh ${edge.strength.toFixed(2)}`}</title>
            </line>
          );
        })}
        {nodes.map((node) => {
          const right = node.angle < 90;
          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-pressed={selected === node.id}
              aria-label={`${node.name}: ${node.paperCount} bài`}
              className={`${styles.node} ${selected === node.id ? styles.nodeSelected : ''}`}
              onClick={() => onSelect(node.id)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onSelect(node.id);
              }}
            >
              <circle cx={node.x} cy={node.y} r={node.r} />
              {/* Labels point away from the centre, so neighbours on the ring do not print over each other. */}
              <text
                className={styles.label}
                x={node.x + (right ? node.r + 4 : -node.r - 4)}
                y={node.y + 4}
                textAnchor={right ? 'start' : 'end'}
                transform={`rotate(${right ? node.angle : node.angle + 180} ${node.x} ${node.y})`}
              >
                {node.name}
              </text>
            </g>
          );
        })}
      </svg>
    </>
  );
}
