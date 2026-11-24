import { useEffect, useMemo, useState } from 'react';
import {
  EdgeLabelRenderer,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useViewport,
  useNodesState,
  useNodes,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/style.css';
import {
  CONTRIBUTION_STAGES,
  contributionGraph,
  groupContributionStages,
  layoutContributionGraph,
} from '@/core/contribution';
import type { PaperModel } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import styles from './contribution.module.css';

type Triple = PaperModel['knowledge']['triples'][number];
type Location = { paragraphId: string; start: number; end: number };
type Props = { model: PaperModel; onLocation: (location: Location) => void };
type PhraseNodeData = {
  label: string;
  degree: number;
  related: boolean;
  central: boolean;
  stage: number;
  dotDiameter: number;
  labelSide: ReturnType<typeof layoutContributionGraph>[number]['labelSide'];
  labelX: number;
  labelY: number;
  labelWidth: number;
  labelHeight: number;
  dotX: number;
  dotY: number;
};
type PhraseFlowNode = Node<PhraseNodeData, 'phrase'>;
type RelationEdgeData = {
  predicate: string;
  lane: number;
  selfLoop: boolean;
};
type RelationFlowEdge = Edge<RelationEdgeData, 'relation'>;

function FitGraphToViewport({ fitKey }: { fitKey: string }) {
  const initialized = useNodesInitialized();
  const nodes = useNodes<PhraseFlowNode>();
  const { fitView } = useReactFlow();
  const currentKey = nodes.map((node) => `${node.id}:${node.data.label}`).join('|');
  useEffect(() => {
    if (!initialized || currentKey !== fitKey) return;
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = window.requestAnimationFrame(() => {
      void fitView({ padding: 0.16, minZoom: 0.38, maxZoom: 1.4, duration: reduceMotion ? 0 : 180 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentKey, fitKey, fitView, initialized]);
  return null;
}

function PhraseNode({ data, selected }: NodeProps<PhraseFlowNode>) {
  const { zoom } = useViewport();
  const [hovered, setHovered] = useState(false);
  const showLabel = selected || data.central || hovered || zoom >= 0.35;
  const handleOffset = data.dotDiameter / 2 + 2;
  return (
    <div
      className={`${styles.graphNode} ${data.central ? styles.graphNodeCentral : ''} ${selected ? styles.graphNodeSelected : ''} ${data.related ? styles.graphNodeRelated : ''}`}
      data-side={data.labelSide}
      title={data.label}
      aria-label={data.label}
      tabIndex={0}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <Handle
        id="left-target"
        type="target"
        position={Position.Left}
        className={`${styles.graphHandle} ${styles.graphHandleLeft}`}
        style={{ left: data.dotX - handleOffset, top: data.dotY }}
      />
      <Handle
        id="right-target"
        type="target"
        position={Position.Right}
        className={`${styles.graphHandle} ${styles.graphHandleRight}`}
        style={{ left: data.dotX + handleOffset, top: data.dotY }}
      />
      <Handle
        id="top-target"
        type="target"
        position={Position.Top}
        className={`${styles.graphHandle} ${styles.graphHandleTop}`}
        style={{ left: data.dotX, top: data.dotY - handleOffset }}
      />
      <Handle
        id="bottom-target"
        type="target"
        position={Position.Bottom}
        className={`${styles.graphHandle} ${styles.graphHandleBottom}`}
        style={{ left: data.dotX, top: data.dotY + handleOffset }}
      />
      <span
        className={styles.graphNodeDot}
        data-stage={data.stage}
        style={{
          left: data.dotX,
          top: data.dotY,
          width: data.dotDiameter,
          height: data.dotDiameter,
        }}
        aria-hidden="true"
      />
      {showLabel && (
        <strong
          className={styles.graphNodeLabel}
          style={{ left: data.labelX, top: data.labelY, width: data.labelWidth, height: data.labelHeight }}
        >
          {data.label}
        </strong>
      )}
      {hovered && (
        <span role="tooltip" className={styles.graphNodeTooltip} style={{ left: data.dotX, top: data.dotY }}>
          {data.label}
        </span>
      )}
      {selected && <small>{data.degree} liên kết</small>}
      <Handle
        id="left-source"
        type="source"
        position={Position.Left}
        className={`${styles.graphHandle} ${styles.graphHandleLeft}`}
        style={{ left: data.dotX - handleOffset, top: data.dotY }}
      />
      <Handle
        id="right-source"
        type="source"
        position={Position.Right}
        className={`${styles.graphHandle} ${styles.graphHandleRight}`}
        style={{ left: data.dotX + handleOffset, top: data.dotY }}
      />
      <Handle
        id="top-source"
        type="source"
        position={Position.Top}
        className={`${styles.graphHandle} ${styles.graphHandleTop}`}
        style={{ left: data.dotX, top: data.dotY - handleOffset }}
      />
      <Handle
        id="bottom-source"
        type="source"
        position={Position.Bottom}
        className={`${styles.graphHandle} ${styles.graphHandleBottom}`}
        style={{ left: data.dotX, top: data.dotY + handleOffset }}
      />
    </div>
  );
}

const phraseNodeTypes = { phrase: PhraseNode };

function graphLayout(graph: ReturnType<typeof contributionGraph>): PhraseFlowNode[] {
  const positions = layoutContributionGraph(graph.nodes, graph.edges);
  const positionsById = new Map(positions.map((position) => [position.id, position]));
  const centralId = positions[0]?.id;
  return graph.nodes.flatMap((node) => {
    const position = positionsById.get(node.id);
    if (!position) return [];
    return [
      {
        id: node.id,
        type: 'phrase' as const,
        position: { x: position.x - position.dotX, y: position.y - position.dotY },
        style: { width: position.width, height: position.height },
        data: {
          label: node.label,
          degree: node.degree,
          related: true,
          central: node.id === centralId,
          stage: node.stage ?? 1,
          dotDiameter: position.dotDiameter,
          labelSide: position.labelSide,
          labelX: position.labelX,
          labelY: position.labelY,
          labelWidth: position.labelWidth,
          labelHeight: position.labelHeight,
          dotX: position.dotX,
          dotY: position.dotY,
        },
      },
    ];
  });
}

function edgeHandles(source: string, target: string, nodes: PhraseFlowNode[], slot = 0) {
  const from = nodes.find((node) => node.id === source);
  const to = nodes.find((node) => node.id === target);
  if (!from || !to) return undefined;
  const dx = to.position.x + to.data.dotX - from.position.x - from.data.dotX;
  const dy = to.position.y + to.data.dotY - from.position.y - from.data.dotY;
  if (source === target) return { sourceHandle: 'right-source', targetHandle: 'top-target' };
  const sides = ['right', 'bottom', 'left', 'top'] as const;
  const baseSource = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';
  const opposite = { right: 'left', bottom: 'top', left: 'right', top: 'bottom' } as const;
  const sourceSide = sides[(sides.indexOf(baseSource) + slot) % sides.length] ?? baseSource;
  const targetBase = opposite[baseSource];
  const targetSide = sides[(sides.indexOf(targetBase) + slot) % sides.length] ?? targetBase;
  return { sourceHandle: `${sourceSide}-source`, targetHandle: `${targetSide}-target` };
}

function RelationEdge({
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  data,
  selected,
}: EdgeProps<RelationFlowEdge>) {
  const [hovered, setHovered] = useState(false);
  const lane = data?.lane ?? 0;
  const path = data?.selfLoop
    ? `M ${sourceX} ${sourceY} L ${sourceX + 42 + lane * 6} ${sourceY} L ${sourceX + 42 + lane * 6} ${targetY - 42 - lane * 6} L ${targetX} ${targetY}`
    : `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  const labelX = (sourceX + targetX) / 2;
  const labelY = (sourceY + targetY) / 2;
  return (
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <path d={path} className="react-flow__edge-path" markerEnd={markerEnd} style={style} />
      <path
        d={path}
        className={styles.graphEdgeHitArea}
        aria-label={`${source} → ${data?.predicate ?? 'liên kết'} → ${target}`}
      />
      {(hovered || selected) && (
        <EdgeLabelRenderer>
          <div
            className={`nodrag nopan ${styles.graphEdgeLabel}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data?.predicate}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

const relationEdgeTypes = { relation: RelationEdge };

function graphEdges(
  graph: ReturnType<typeof contributionGraph>,
  nodes: PhraseFlowNode[],
  selected?: string,
): RelationFlowEdge[] {
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const validEdges = graph.edges.filter(
    (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
  );
  const pairs = new Map<string, typeof validEdges>();
  validEdges.forEach((edge) => {
    const key = [edge.source, edge.target].sort().join('\u0000');
    pairs.set(key, [...(pairs.get(key) ?? []), edge]);
  });
  const lanes = new Map<number, number>();
  pairs.forEach((pair) => {
    const ordered = [...pair].sort(
      (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.index - b.index,
    );
    ordered.forEach((edge, index) => {
      lanes.set(edge.index, index);
    });
  });

  return validEdges.flatMap((edge) => {
    const handles = edgeHandles(edge.source, edge.target, nodes, lanes.get(edge.index) ?? 0);
    if (!handles) return [];
    const stage = CONTRIBUTION_STAGES[edge.stage];
    const related = edge.source === selected || edge.target === selected;
    return [
      {
        id: `relation-${edge.index}`,
        type: 'relation' as const,
        source: edge.source,
        target: edge.target,
        ...handles,
        data: {
          predicate: edge.predicate,
          lane: lanes.get(edge.index) ?? 0,
          selfLoop: edge.source === edge.target,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: stage?.color },
        style: {
          stroke: stage?.color ?? 'var(--accent)',
          strokeWidth: related ? 2.5 : 1.5,
          opacity: selected && !related ? 0.08 : 0.24,
        },
        interactionWidth: 20,
      },
    ];
  });
}

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
  const graph = useMemo(() => contributionGraph(model.knowledge), [model.knowledge]);
  const initialNodes = useMemo(() => graphLayout(graph), [graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);
  const activeSelection = graph.nodes.some((node) => node.id === selected) ? selected : undefined;
  const related = useMemo(() => {
    const ids = new Set<string>();
    if (activeSelection) {
      ids.add(activeSelection);
      graph.edges.forEach((edge) => {
        if (edge.source === activeSelection) ids.add(edge.target);
        if (edge.target === activeSelection) ids.add(edge.source);
      });
    }
    return ids;
  }, [activeSelection, graph.edges]);
  const visibleNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === activeSelection,
        data: { ...node.data, related: !activeSelection || related.has(node.id) },
      })),
    [nodes, related, activeSelection],
  );
  const edges = useMemo(() => graphEdges(graph, nodes, activeSelection), [graph, nodes, activeSelection]);
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
        <div className={styles.graphView}>
          {model.knowledge.triples.length > 40 && (
            <p className={styles.graphNotice}>
              Chỉ hiển thị 20 nút có nhiều liên kết nhất; mở Dòng contribution để xem toàn bộ bộ ba.{' '}
              <Button variant="ghost" size="sm" onClick={() => setView('flow')}>
                Mở Dòng contribution
              </Button>
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
          <div className={styles.graphWorkspace}>
            <div className={styles.graphCanvas} aria-label="Đồ thị cụm từ và quan hệ">
              <ReactFlow
                nodes={visibleNodes}
                edges={edges}
                nodeTypes={phraseNodeTypes}
                edgeTypes={relationEdgeTypes}
                nodeOrigin={[0, 0]}
                onNodesChange={onNodesChange}
                onNodeClick={(_event, node) => setSelected(node.id)}
                onPaneClick={() => setSelected(undefined)}
                fitView={false}
                minZoom={0.25}
                maxZoom={1.6}
                nodesDraggable
                nodesConnectable={false}
                elementsSelectable={false}
                onlyRenderVisibleElements
              >
                <FitGraphToViewport
                  fitKey={graph.nodes.map((node) => `${node.id}:${node.label}`).join('|')}
                />
                <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--border-subtle)" />
                <Controls position="top-right" showInteractive={false} />
              </ReactFlow>
            </div>
            <aside className={styles.graphInspector} aria-label="Chi tiết nút đồ thị">
              {activeSelection ? (
                <>
                  <div className={styles.graphInspectorHead}>
                    <span>Nút đang chọn</span>
                    <h3>
                      {graph.nodes.find((node) => node.id === activeSelection)?.label ?? activeSelection}
                    </h3>
                  </div>
                  <div className={styles.graphConnections}>
                    {graph.allEdges
                      .filter((edge) => edge.source === activeSelection || edge.target === activeSelection)
                      .map((edge) => (
                        <TripleCard
                          key={edge.index}
                          triple={edge.triple}
                          model={model}
                          onLocation={onLocation}
                        />
                      ))}
                  </div>
                </>
              ) : (
                <div className={styles.graphEmpty}>
                  <span className={styles.graphEmptyMark} aria-hidden="true">
                    ↗
                  </span>
                  <h3>Khám phá mối liên hệ</h3>
                  <p>Chọn một nút để xem các bộ ba và câu nguồn trong bài.</p>
                </div>
              )}
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
