import { useMemo, useState } from 'react';
import {
  KG_LAYERS,
  toJsonLd,
  toSciAtlasCorpusReport,
  toTurtle,
  type CorpusKg,
  type KgLayer,
} from '@/core/openkg';
import { downloadText } from '@/shared/calibration/download';
import { ActionBar, ActionMenu, Stat, StatGrid } from '@/shared/ui/ActionBar';
import { Chip } from '@/shared/ui/Chip';
import { OpenKgGraph } from '@/shared/ui/openkg/OpenKgGraph';
import { OpenKgTriples } from '@/shared/ui/openkg/OpenKgTriples';
import { LAYER_LABELS, NODE_LABELS } from '@/shared/ui/openkg/labels';
import styles from '@/shared/ui/openkg/openkg.module.css';
import { CorpusOpenKgTrend } from './CorpusOpenKgTrend';
import { OpenKgNodeList } from './OpenKgNodeList';
import { OpenKgSupport } from './OpenKgSupport';
import corpusStyles from './corpus-openkg.module.css';

const NODE_LIMIT = 120;
const NODE_TYPES = Object.keys(NODE_LABELS) as (keyof typeof NODE_LABELS)[];

function visibleGraph(kg: CorpusKg, enabled: ReadonlySet<KgLayer>) {
  const edges = kg.edges.filter(({ layer }) => enabled.has(layer));
  const degree = new Map<string, number>();
  for (const { s, o } of edges) {
    degree.set(s, (degree.get(s) ?? 0) + 1);
    if (s !== o) degree.set(o, (degree.get(o) ?? 0) + 1);
  }
  const nodes = kg.nodes.filter(({ id, layer }) => degree.has(id) || enabled.has(layer));
  const drawn = [...nodes]
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id))
    .slice(0, NODE_LIMIT)
    .sort((a, b) => a.id.localeCompare(b.id));
  const drawnIds = new Set(drawn.map(({ id }) => id));
  return {
    edges,
    nodes: new Map(nodes.map((node) => [node.id, node])),
    diagram: { nodes: drawn, edges: edges.filter(({ s, o }) => drawnIds.has(s) && drawnIds.has(o)) },
  };
}

export function CorpusOpenKgView({ kg, corpusId, title }: { kg: CorpusKg; corpusId: string; title: string }) {
  const [enabled, setEnabled] = useState<ReadonlySet<KgLayer>>(() => new Set(KG_LAYERS));
  const [selected, setSelected] = useState<string>();
  const { nodes, edges, diagram } = useMemo(() => visibleGraph(kg, enabled), [kg, enabled]);
  const papers = useMemo(
    () => new Map(kg.nodes.filter(({ type }) => type === 'Paper').map(({ id, label }) => [id, label])),
    [kg],
  );
  const current = selected ? nodes.get(selected) : undefined;
  const coverage = kg.coverage;
  const exportFile = (extension: string, mime: string, content: string) =>
    downloadText(`openkg-corpus-${corpusId}.${extension}`, content, mime);

  return (
    <>
      <ActionBar status={`${kg.nodes.length} nút · ${kg.edges.length} bộ ba`}>
        <ActionMenu
          label="Xuất đồ thị"
          items={[
            { label: 'Turtle (.ttl)', onSelect: () => exportFile('ttl', 'text/turtle', toTurtle(kg)) },
            {
              label: 'JSON-LD (.jsonld)',
              onSelect: () => exportFile('jsonld', 'application/ld+json', toJsonLd(kg)),
            },
            {
              label: 'Báo cáo (.md)',
              onSelect: () => exportFile('md', 'text/markdown', toSciAtlasCorpusReport(kg, title)),
            },
          ]}
        />
      </ActionBar>
      <StatGrid>
        <Stat label="Bài có mô hình" value={`${coverage.withModel}/${coverage.members}`} />
        <Stat label="Bài có tra cứu OpenAlex" value={`${coverage.withLookup}/${coverage.members}`} />
        <Stat label="Bài có kết quả SCG" value={`${coverage.withScg}/${coverage.members}`} />
      </StatGrid>
      {kg.nodes.length > 0 ? (
        <>
          <fieldset className={styles.layers}>
            <legend>Bộ ba theo lớp</legend>
            {KG_LAYERS.map((layer) => (
              <Chip
                key={layer}
                data-layer={layer}
                count={kg.layerCounts[layer].edges}
                aria-pressed={enabled.has(layer)}
                onClick={() =>
                  setEnabled((previous) => {
                    const next = new Set(previous);
                    if (next.has(layer)) next.delete(layer);
                    else next.add(layer);
                    return next;
                  })
                }
              >
                <span className={styles.swatch} aria-hidden="true" />
                {LAYER_LABELS[layer]}
              </Chip>
            ))}
          </fieldset>
          <details className={styles.textList}>
            <summary>Số nút theo loại</summary>
            <ul className={corpusStyles.nodeCounts}>
              {NODE_TYPES.map((type) => {
                const count = kg.nodeCounts[type];
                return count ? (
                  <li key={type}>
                    {NODE_LABELS[type]} · {count}
                  </li>
                ) : null;
              })}
            </ul>
          </details>
          {nodes.size > diagram.nodes.length && (
            <p className={styles.muted}>
              Hình vẽ hiện {diagram.nodes.length}/{nodes.size} nút có nhiều liên kết nhất. Danh sách nút và
              tệp xuất giữ đầy đủ dữ liệu.
            </p>
          )}
          {nodes.size ? (
            <>
              <div className={styles.layout}>
                <OpenKgGraph layout="corpus" graph={diagram} selected={current?.id} onSelect={setSelected} />
                <aside className={styles.inspector} aria-label="Chi tiết nút">
                  <h3 aria-live="polite">{current?.label ?? 'Chi tiết nút'}</h3>
                  {current ? (
                    <>
                      <p className={styles.muted}>{NODE_LABELS[current.type]}</p>
                      <OpenKgTriples
                        nodes={nodes}
                        edges={edges.filter(({ s, o }) => s === current.id || o === current.id)}
                        renderDetails={(edge) => <OpenKgSupport edge={edge} papers={papers} />}
                      />
                    </>
                  ) : (
                    <p className={styles.muted}>Chọn một nút để xem các bộ ba và bài báo làm căn cứ.</p>
                  )}
                </aside>
              </div>
              <OpenKgNodeList nodes={[...nodes.values()]} selected={current?.id} onSelect={setSelected} />
            </>
          ) : (
            <p className={styles.muted}>Không có nút trong các lớp đang bật.</p>
          )}
        </>
      ) : (
        <p className={styles.muted}>Corpus chưa có bài nào để lập đồ thị.</p>
      )}
      <CorpusOpenKgTrend trend={kg.trend} />
    </>
  );
}
