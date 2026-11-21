import { useState } from 'react';
import { CONTRIBUTION_STAGES, contributionGraph, groupContributionStages } from '@/core/contribution';
import type { PaperModel } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import styles from './contribution.module.css';

type Triple = PaperModel['knowledge']['triples'][number];
type Location = { paragraphId: string; start: number; end: number };
type Props = { model: PaperModel; onLocation: (location: Location) => void };

function TripleCard({
  triple,
  model,
  onLocation,
  expanded = false,
}: Props & { triple: Triple; expanded?: boolean }) {
  const phrases = new Map(model.knowledge.phrases.map((phrase) => [phrase.id, phrase.text]));
  const sentence = model.sentences.find((item) => item.key === triple.key);
  return (
    <details className={styles.card} open={expanded || undefined}>
      <summary>
        {phrases.get(triple.subject)} → {phrases.get(triple.predicate)} → {phrases.get(triple.object)}
      </summary>
      {sentence && (
        <>
          <p>{sentence.text}</p>
          <Button
            size="sm"
            onClick={() =>
              onLocation({ paragraphId: sentence.paragraphId, start: sentence.start, end: sentence.end })
            }
          >
            {sentence.page ? `Tr. ${sentence.page}` : 'Đoạn gốc'}
          </Button>
        </>
      )}
    </details>
  );
}

export function ContributionViews({ model, onLocation }: Props) {
  const [view, setView] = useState('flow');
  const [selected, setSelected] = useState<string>();
  const graph = contributionGraph(model.knowledge);
  const positions = new Map(graph.nodes.map((node) => [node.id, node]));
  return (
    <div className={styles.views}>
      <SegmentedControl
        label="Cách xem contribution"
        value={view}
        onChange={setView}
        options={[
          { value: 'flow', label: 'Dòng contribution' },
          { value: 'graph', label: 'Đồ thị tri thức' },
        ]}
      />
      {view === 'flow' ? (
        <div className={styles.flow}>
          {groupContributionStages(model.knowledge.triples).map((stage) => (
            <section key={stage.label} className={styles.stage} style={{ borderTopColor: stage.color }}>
              <h3>
                {stage.label} <span>({stage.count})</span>
              </h3>
              {stage.groups.length === 0 && <p>Chưa có</p>}
              {stage.groups.map((group) => (
                <div key={group.unit}>
                  <h4>{group.unit}</h4>
                  {group.triples.map((triple, index) => (
                    <TripleCard
                      key={`${triple.key}-${index}`}
                      triple={triple}
                      model={model}
                      onLocation={onLocation}
                    />
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div>
          {model.knowledge.triples.length > 40 && (
            <p>
              Chỉ hiển thị 20 nút có nhiều liên kết nhất.{' '}
              <Button variant="ghost" size="sm" onClick={() => setView('flow')}>
                Xem tất cả trong Dòng contribution
              </Button>
              .
            </p>
          )}
          <ul className={styles.legend}>
            {CONTRIBUTION_STAGES.map((stage) => (
              <li key={stage.label}>
                <span style={{ background: stage.color }} />
                {stage.label}
              </li>
            ))}
          </ul>
          <svg
            className={styles.graph}
            viewBox="0 0 800 500"
            role="group"
            aria-label="Đồ thị các cụm từ và quan hệ. Chọn một nút để xem các bộ ba bên dưới."
          >
            <defs>
              <marker
                id="contribution-arrow"
                viewBox="0 0 10 10"
                refX="13"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
              </marker>
            </defs>
            {graph.edges.map((edge) => {
              const from = positions.get(edge.source);
              const to = positions.get(edge.target);
              if (!from || !to) return null;
              const active = !selected || edge.source === selected || edge.target === selected;
              return (
                <g key={edge.index} opacity={active ? 1 : 0.16}>
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={CONTRIBUTION_STAGES[edge.stage]?.color}
                    strokeWidth="2"
                    markerEnd="url(#contribution-arrow)"
                  />
                  <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2} className={styles.edgeLabel}>
                    {edge.predicate}
                  </text>
                </g>
              );
            })}
            {graph.nodes.map((node) => (
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                aria-label={node.label}
                aria-pressed={selected === node.id}
                onClick={() => setSelected(node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelected(node.id);
                  }
                }}
                className={styles.node}
              >
                <circle cx={node.x} cy={node.y} r="9" />
                <text x={node.x} y={node.y + 23} textAnchor="middle">
                  {node.label.length > 25 ? `${node.label.slice(0, 24)}…` : node.label}
                </text>
              </g>
            ))}
          </svg>
          {selected ? (
            <section aria-label="Bộ ba của nút đã chọn">
              <h3>{graph.nodes.find((node) => node.id === selected)?.label}</h3>
              {graph.allEdges
                .filter((edge) => edge.source === selected || edge.target === selected)
                .map((edge) => (
                  <TripleCard
                    key={edge.index}
                    triple={edge.triple}
                    model={model}
                    onLocation={onLocation}
                    expanded
                  />
                ))}
            </section>
          ) : (
            <p>Chọn một nút để xem các bộ ba và câu nguồn.</p>
          )}
        </div>
      )}
    </div>
  );
}
