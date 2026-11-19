import { useId, useState } from 'react';
import type { StageContent } from '@/core/autoresearch/contracts';
import { Badge } from '@/shared/ui/Badge';
import styles from './autoresearch.module.css';

type Graph = StageContent['S9']['graph'];
const labels = {
  evidence: 'Evidence',
  claim: 'Claim',
  gap: 'Research gap',
  hypothesis: 'Hypothesis',
  question: 'Research question',
  assumption: 'Assumption',
  contribution: 'Contribution',
} as const;
const statusLabels = { stated: 'Đã nêu', derived: 'Suy ra', unreviewed: 'Chưa xem xét' };
const columns = Object.keys(labels) as (keyof typeof labels)[];

export function ArgumentGraph({ graph }: { graph: Graph }) {
  const arrow = useId();
  const [selectedId, setSelectedId] = useState(graph.entities[0]?.id);
  const selected = graph.entities.find(({ id }) => id === selectedId) ?? graph.entities[0];
  const groups = columns
    .map((type) => ({
      type,
      nodes: graph.entities.filter((entity) => entity.type === type),
    }))
    .filter(({ nodes }) => nodes.length);
  const points = new Map(
    groups.flatMap(({ nodes }, col) =>
      nodes.map((entity, row) => [entity.id, { entity, x: 81 + col * 162, y: 62 + row * 48 }] as const),
    ),
  );
  const height = 48 * Math.max(2, ...groups.map(({ nodes }) => nodes.length)) + 40;
  const edges = graph.relations.filter(({ from, to }) => from === selected?.id || to === selected?.id);
  return (
    <section aria-label="Argument map">
      <div className={styles.graphScroll}>
        <svg
          className={styles.argumentGraph}
          viewBox={`0 0 ${Math.max(1, groups.length) * 162} ${height}`}
          role="group"
          aria-label="Đồ thị Argument map"
        >
          <defs>
            <marker
              id={arrow}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          <g aria-hidden="true">
            {groups.map(({ type }, index) => (
              <text key={type} x={81 + index * 162} y={24} textAnchor="middle">
                {labels[type]}
              </text>
            ))}
            {graph.relations.map((edge) => {
              const start = points.get(edge.from);
              const end = points.get(edge.to);
              if (!start || !end) return null;
              const dx = end.x - start.x;
              const dy = end.y - start.y;
              const length = Math.hypot(dx, dy);
              if (!length) return null;
              const ux = dx / length;
              const uy = dy / length;
              return (
                <line
                  key={JSON.stringify([edge.from, edge.relation, edge.to])}
                  x1={start.x + 14 * ux}
                  y1={start.y + 14 * uy}
                  x2={end.x - 16 * ux}
                  y2={end.y - 16 * uy}
                  className={styles.argumentEdge}
                  data-active={edges.includes(edge)}
                  markerEnd={`url(#${arrow})`}
                />
              );
            })}
          </g>
          {[...points.values()].map(({ entity, x, y }) => (
            <g
              key={entity.id}
              className={styles.argumentNode}
              role="button"
              tabIndex={0}
              aria-label={`${labels[entity.type]} · ${entity.text}`}
              aria-pressed={selected?.id === entity.id}
              onClick={() => setSelectedId(entity.id)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                setSelectedId(entity.id);
              }}
            >
              <title>{entity.text}</title>
              <circle cx={x} cy={y} r={13} />
            </g>
          ))}
        </svg>
      </div>
      {selected && (
        <div aria-live="polite">
          <p>
            <Badge>{labels[selected.type]}</Badge>{' '}
            {selected.evidence_scope && (
              <Badge>{selected.evidence_scope === 'full_text' ? 'Full text' : 'Abstract'}</Badge>
            )}{' '}
            {selected.text}
          </p>
          {edges.length > 0 && (
            <ul className={styles.rows}>
              {edges.map((edge) => (
                <li key={JSON.stringify([edge.from, edge.relation, edge.to])}>
                  {points.get(edge.from)?.entity.text} → <strong>{edge.relation.replaceAll('_', ' ')}</strong>{' '}
                  → {points.get(edge.to)?.entity.text} <Badge>{statusLabels[edge.status]}</Badge>
                  <div>{edge.rationale}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
