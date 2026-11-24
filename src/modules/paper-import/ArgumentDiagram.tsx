import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChangeset,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/style.css';
import type { ArgumentEdge, ArgumentNode } from '@/core/argument';
import {
  aifDiagram,
  paperDiagram,
  type DiagramNode,
  type DiagramRole,
  type Orientation,
  toulminDiagram,
} from '@/core/argument/diagram';
import type { Argument, Paper } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { ReviewActions } from '@/shared/ui/FindingCard';
import { Select } from '@/shared/ui/Select';
import { PAPER_LABELS } from './labels';
import { ClaimTypeBadge } from './ClaimTypes';
import { EvidenceLevelBadge } from './EvidenceLevel';
import { PlaceText } from './PlaceText';
import styles from './argument.module.css';

type Span = Argument['claim'];
type FlowNodeData = {
  model: DiagramNode;
  content: ReactNode;
  ariaLabel: string;
  orientation: Orientation;
  onNudge: (id: string, key: string) => void;
};
type ArgumentFlowNode = Node<FlowNodeData, 'argument'>;

const ROLES: Record<DiagramRole, string> = {
  claim: 'Claim',
  data: 'Grounds',
  warrant: 'Warrant',
  backing: 'Backing',
  qualifier: 'Qualifier',
  rebuttal: 'Rebuttal',
  premise: 'Premise',
  conclusion: 'Conclusion',
  ra: 'Inference',
  ca: 'Conflict',
};
const nodeTypes = { argument: ArgumentFlowNodeView };
const motionDuration = (duration: number) =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 0
    : duration;
const short = (text: string) =>
  Array.from(text).length > 44 ? `${Array.from(text).slice(0, 44).join('')}…` : text;

function ArgumentFlowNodeView({
  id,
  data,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<ArgumentFlowNode>) {
  const { model } = data;
  const vertical = data.orientation === 'vertical';
  const scheme = model.kind === 'scheme';
  return (
    <div
      className={scheme ? styles.dSchemeNode : styles.dNode}
      data-role={model.role}
      data-missing={model.missing}
      data-testid={`node-${id}`}
      data-position-x={positionAbsoluteX}
      data-position-y={positionAbsoluteY}
      role="group"
      aria-label={data.ariaLabel}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key.startsWith('Arrow')) {
          event.preventDefault();
          event.stopPropagation();
          data.onNudge(id, event.key);
        }
      }}
    >
      <Handle type="target" position={vertical ? Position.Top : Position.Left} className={styles.dHandle} />
      {data.content}
      <Handle
        type="source"
        position={vertical ? Position.Bottom : Position.Right}
        className={styles.dHandle}
      />
    </div>
  );
}

/** The argument map uses computed academic layouts and React Flow for pan, zoom, and node movement. */
export function ArgumentDiagram({
  paper,
  items,
  states,
  view,
  onLocation,
  onDecide,
  graph,
  selectedId,
  onSelectedIdChange,
  showArgumentPicker = true,
}: {
  paper: Paper;
  graph?: { nodes: ArgumentNode[]; edges: ArgumentEdge[] };
  items: Argument[];
  states: Map<string, 'confirmed' | 'dismissed'>;
  view: 'toulmin' | 'aif';
  onLocation: (span: Span) => void;
  onDecide: (id: string, decision: 'confirm' | 'dismiss' | 'reopen') => void;
  selectedId?: string;
  onSelectedIdChange?: (id: string) => void;
  showArgumentPicker?: boolean;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const flow = useRef<ReactFlowInstance<ArgumentFlowNode, Edge> | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [orientation, setOrientation] = useState<Orientation | 'auto'>('auto');
  const [positions, setPositions] = useState<Record<string, Record<string, { x: number; y: number }>>>({});
  const [conflicts, setConflicts] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [localSelected, setLocalSelected] = useState(items[0]?.id ?? '');
  const selected = selectedId ?? localSelected;
  const setSelected = onSelectedIdChange ?? setLocalSelected;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const update = () => setCanvasWidth(element.clientWidth);
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);

  const index = Math.max(
    0,
    items.findIndex((candidate) => candidate.id === selected),
  );
  const item = items[index];
  if (!item) return <p className={styles.empty}>Chưa có argument nào để vẽ.</p>;

  const whole = view === 'aif' && selected === '__whole';
  const direction =
    orientation === 'auto' ? (canvasWidth > 0 && canvasWidth < 720 ? 'vertical' : 'horizontal') : orientation;
  const layout = whole
    ? paperDiagram(graph ?? { nodes: [], edges: [] }, conflicts)
    : view === 'toulmin'
      ? toulminDiagram(item, direction)
      : aifDiagram(item, direction);
  const layoutKey = `${view}:${whole ? '__whole' : item.id}:${direction}`;
  const diagram = {
    ...layout,
    nodes: layout.nodes.map((node) => ({ ...node, ...positions[layoutKey]?.[node.id] })),
  };
  const state = states.get(item.id);

  const move = (id: string, x: number, y: number) => {
    const next = { x: Math.max(0, x), y: Math.max(0, y) };
    setPositions((current) => ({ ...current, [layoutKey]: { ...current[layoutKey], [id]: next } }));
  };
  const onNudge = (id: string, key: string) => {
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-10, 0],
      ArrowRight: [10, 0],
      ArrowUp: [0, -10],
      ArrowDown: [0, 10],
    };
    const step = delta[key];
    const node = diagram.nodes.find((candidate) => candidate.id === id);
    if (step && node) move(id, node.x + step[0], node.y + step[1]);
  };
  const onNodesChange = (changes: NodeChangeset<ArgumentFlowNode>) => {
    const moved = changes.getByType('position').filter((change) => change.position);
    if (!moved.length) return;
    setPositions((current) => {
      const next = { ...current[layoutKey] };
      for (const change of moved) {
        if (change.type === 'position' && change.position) next[change.id] = change.position;
      }
      return { ...current, [layoutKey]: next };
    });
  };

  const card = (node: DiagramNode) => (
    <div className={styles.dNodeContent}>
      <div className={styles.dHead}>
        <span className={styles.dRole}>
          {view === 'aif' && <span className={styles.dKind}>I</span>}
          {ROLES[node.role]}
        </span>
        {node.inferred && <Badge tone="warning">AI suy ra</Badge>}
      </div>
      {node.missing ? (
        <p className={styles.dMissing}>{PAPER_LABELS.notIdentified}</p>
      ) : (
        <p className={styles.dText} title={node.text ?? undefined}>
          {node.text}
        </p>
      )}
      {node.span ? (
        <Button
          className="nodrag"
          size="sm"
          variant="ghost"
          onClick={() => node.span && onLocation(node.span)}
        >
          <PlaceText paper={paper} paragraphId={node.span.paragraphId} />
        </Button>
      ) : node.inferred ? (
        <span className={styles.dNote}>Không phải lời tác giả</span>
      ) : null}
    </div>
  );

  const nodes: ArgumentFlowNode[] = diagram.nodes.map((node) => ({
    id: node.id,
    type: 'argument',
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    draggable: true,
    selectable: false,
    focusable: true,
    ariaLabel: `${ROLES[node.role]}: di chuyển bằng phím mũi tên`,
    data: {
      model: node,
      orientation: direction,
      ariaLabel: `${ROLES[node.role]}: di chuyển bằng phím mũi tên`,
      content:
        node.kind === 'scheme' ? (
          <div className={styles.dSchemeContent}>
            <strong>{node.role === 'ra' ? 'RA' : 'CA'}</strong>
            <span>{ROLES[node.role]}</span>
            {node.role === 'ra' && (
              <small>{diagram.edges.filter((edge) => edge.to === node.id).length} tiền đề → 1 kết luận</small>
            )}
          </div>
        ) : (
          card(node)
        ),
      onNudge,
    },
  }));

  const edges: Edge[] = diagram.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: 'smoothstep',
    label: edge.label || undefined,
    className: `${styles.dEdge} ${styles[`dEdge${edge.tone[0]?.toUpperCase()}${edge.tone.slice(1)}`]} ${edge.dashed ? styles.dEdgeDashed : ''}`,
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--text-muted)' },
    labelStyle: { fill: 'var(--text-secondary)', fontSize: 12 },
    labelBgStyle: { fill: 'var(--surface)', fillOpacity: 0.95 },
    labelBgPadding: [5, 3],
    labelBgBorderRadius: 4,
    interactionWidth: 16,
    selectable: false,
  }));

  const zoomBy = (delta: 1 | -1) => {
    const duration = motionDuration(150);
    void (delta < 0 ? flow.current?.zoomOut({ duration }) : flow.current?.zoomIn({ duration }));
  };
  const fit = () => void flow.current?.fitView({ padding: 0.14, duration: motionDuration(180) });
  const resetLayout = () => {
    setPositions((current) => {
      const next = { ...current };
      delete next[layoutKey];
      return next;
    });
    requestAnimationFrame(fit);
  };

  return (
    <div className={styles.diagram}>
      <div
        className={styles.dToolbar}
        data-compact={!showArgumentPicker}
        aria-label="Điều khiển lược đồ argument"
      >
        {showArgumentPicker && (
          <div className={styles.dArgumentControls}>
            <Select
              label="Argument"
              size="sm"
              value={whole ? '__whole' : item.id}
              onChange={(event) => setSelected(event.target.value)}
            >
              {view === 'aif' && <option value="__whole">Toàn bài</option>}
              {items.map((option, position) => (
                <option key={option.id} value={option.id}>
                  {position + 1}. {short(option.claim.excerpt)}
                </option>
              ))}
            </Select>
            <div className={styles.dStepper} aria-label={`Argument ${index + 1} trên ${items.length}`}>
              <Button
                size="sm"
                disabled={whole || index === 0}
                aria-label="Argument trước"
                onClick={() => setSelected(items[index - 1]?.id ?? item.id)}
              >
                ‹
              </Button>
              <span className={styles.dCount}>
                {index + 1} / {items.length}
              </span>
              <Button
                size="sm"
                disabled={whole || index >= items.length - 1}
                aria-label="Argument sau"
                onClick={() => setSelected(items[index + 1]?.id ?? item.id)}
              >
                ›
              </Button>
            </div>
          </div>
        )}
        <div className={styles.dViewControls}>
          <Button size="sm" aria-label="Thu nhỏ sơ đồ" onClick={() => zoomBy(-1)}>
            −
          </Button>
          <span className={styles.dCount}>{Math.round(zoom * 100)}%</span>
          <Button size="sm" aria-label="Phóng to sơ đồ" onClick={() => zoomBy(1)}>
            +
          </Button>
          <Button size="sm" variant="ghost" aria-label="Vừa khung" onClick={fit}>
            Vừa khung
          </Button>
          <details className={styles.dMore}>
            <summary>Tùy chọn</summary>
            <div className={styles.dMoreMenu}>
              <Select
                label="Hướng bố cục"
                size="sm"
                value={orientation}
                onChange={(event) => setOrientation(event.target.value as Orientation | 'auto')}
              >
                <option value="auto">Tự động</option>
                <option value="horizontal">Ngang</option>
                <option value="vertical">Dọc</option>
              </Select>
              <Button size="sm" onClick={resetLayout}>
                Bố cục lại
              </Button>
              {whole && (
                <Button size="sm" aria-pressed={conflicts} onClick={() => setConflicts(!conflicts)}>
                  Chỉ hiện xung đột
                </Button>
              )}
            </div>
          </details>
        </div>
      </div>

      {!whole && (
        <div className={styles.dBar}>
          <Badge tone={item.importance === 'main' ? 'accent' : 'neutral'}>
            {item.importance === 'main' ? 'Claim chính' : 'Claim phụ'}
          </Badge>
          <ClaimTypeBadge type={item.claimType} />
          <EvidenceLevelBadge level={item.evidenceLevel} basis={item.evidenceBasis} />
          {state && (
            <Badge tone={state === 'confirmed' ? 'success' : 'danger'}>
              {state === 'confirmed' ? 'Đã xác nhận' : 'Đã bác bỏ'}
            </Badge>
          )}
          <span className={styles.note}>
            {view === 'toulmin'
              ? `${diagram.identified}/6 thành phần đã xác định. Ô nét đứt là thành phần chưa thấy trong bài.`
              : 'I là nội dung trong bài. RA là bước suy luận nối tiền đề với kết luận, CA là bước phản bác.'}
          </span>
          <span className={styles.dSpacer} />
          <ReviewActions
            acceptByDefault
            decided={Boolean(state)}
            dismissLabel="Loại bỏ"
            onConfirm={() => onDecide(item.id, 'confirm')}
            onDismiss={() => onDecide(item.id, 'dismiss')}
            onUndo={() => onDecide(item.id, 'reopen')}
          />
        </div>
      )}

      <div className={styles.dViewport}>
        <div className={styles.dCanvas} ref={canvas}>
          <div
            className={styles.dFlow}
            role="group"
            aria-label={
              whole
                ? `Lược đồ AIF của toàn bài (${items.filter((argument) => states.get(argument.id) !== 'dismissed').length} arguments)`
                : `Lược đồ ${view === 'toulmin' ? 'Toulmin' : 'AIF'} của argument ${index + 1}`
            }
          >
            <ReactFlow
              key={`${layoutKey}:${conflicts}`}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onInit={(instance) => {
                flow.current = instance;
                setZoom(instance.getZoom());
              }}
              onMoveEnd={(_event, viewport) => setZoom(viewport.zoom)}
              fitView
              fitViewOptions={{ padding: 0.14, duration: motionDuration(180) }}
              minZoom={0.35}
              maxZoom={2.4}
              nodesConnectable={false}
              nodesDraggable
              elementsSelectable={false}
              deleteKeyCode={null}
              onlyRenderVisibleElements
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--border-subtle)" />
            </ReactFlow>
          </div>
        </div>
      </div>
    </div>
  );
}
