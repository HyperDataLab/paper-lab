import { useState } from 'react';
import {
  aifDiagram,
  edgePath,
  toulminDiagram,
  type DiagramNode,
  type DiagramRole,
} from '@/core/argument/diagram';
import type { Argument, Paper } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { ReviewActions } from '@/shared/ui/FindingCard';
import { Select } from '@/shared/ui/Select';
import { placeLabel } from './paperLabels';
import styles from './argument.module.css';

type Span = Argument['claim'];
const ROLES: Record<DiagramRole, string> = {
  claim: 'Luận điểm',
  data: 'Dữ liệu',
  warrant: 'Lý lẽ nối',
  backing: 'Hậu thuẫn',
  qualifier: 'Giới hạn',
  rebuttal: 'Phản biện',
  premise: 'Tiền đề',
  conclusion: 'Kết luận',
  ra: 'Suy luận',
  ca: 'Phản bác',
};
const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5];
const PAD = 12;
const short = (text: string) =>
  Array.from(text).length > 44 ? `${Array.from(text).slice(0, 44).join('')}…` : text;

/**
 * One argument drawn as a diagram: boxes for the passages, lines for how they bear on each other. The reader
 * steps through the arguments one at a time; the drawing is computed, so it never has to be arranged by hand.
 */
export function ArgumentDiagram({
  paper,
  items,
  states,
  view,
  onLocation,
  onDecide,
}: {
  paper: Paper;
  /** The arguments to step through, in the order they should be offered. */
  items: Argument[];
  states: Map<string, 'confirmed' | 'dismissed'>;
  view: 'toulmin' | 'aif';
  onLocation: (span: Span) => void;
  onDecide: (id: string, decision: 'confirm' | 'dismiss' | 'reopen') => void;
}) {
  const [selected, setSelected] = useState(items[0]?.id ?? '');
  // A number is a fixed scale, readable at any width because the canvas scrolls. Null fits the drawing to
  // the width it has, which beside the paper can be too small to read, so it is a choice and not the default.
  const [zoom, setZoom] = useState<number | null>(1);
  const index = Math.max(
    0,
    items.findIndex((item) => item.id === selected),
  );
  const item = items[index];
  if (!item) return <p className={styles.empty}>Chưa có lập luận nào để vẽ.</p>;
  const diagram = view === 'toulmin' ? toulminDiagram(item) : aifDiagram(item);
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  const state = states.get(item.id);
  const width = diagram.width + PAD * 2;
  const height = diagram.height + PAD * 2;
  const step = (direction: 1 | -1) => {
    const scale = zoom ?? 1;
    const at = ZOOMS.findIndex((value) => value >= scale);
    setZoom(
      ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (at < 0 ? ZOOMS.length - 1 : at) + direction))] ?? 1,
    );
  };
  const premises = diagram.nodes.filter((node) => node.role === 'premise').length;

  const card = (node: DiagramNode) => (
    <div className={styles.dNode} data-role={node.role} data-missing={node.missing}>
      <div className={styles.dHead}>
        <span className={styles.dRole}>
          {view === 'aif' && <span className={styles.dKind}>I</span>}
          {ROLES[node.role]}
        </span>
        {node.inferred && <Badge tone="warning">AI suy ra</Badge>}
      </div>
      {node.missing ? (
        <p className={styles.dMissing}>Chưa xác định</p>
      ) : (
        <p className={styles.dText} title={node.text ?? undefined}>
          {node.text}
        </p>
      )}
      {node.span ? (
        <Button size="sm" variant="ghost" onClick={() => node.span && onLocation(node.span)}>
          {placeLabel(paper, node.span.paragraphId)}
        </Button>
      ) : node.inferred ? (
        <span className={styles.dNote}>Không phải lời tác giả</span>
      ) : null}
    </div>
  );
  return (
    <div className={styles.diagram}>
      <div className={styles.dBar}>
        <Select
          label="Lập luận"
          size="sm"
          value={item.id}
          onChange={(event) => setSelected(event.target.value)}
        >
          {items.map((option, position) => (
            <option key={option.id} value={option.id}>
              {position + 1}. {short(option.claim.excerpt)}
            </option>
          ))}
        </Select>
        <span className={styles.dCount}>
          {index + 1} / {items.length}
        </span>
        <Button
          size="sm"
          disabled={index === 0}
          aria-label="Lập luận trước"
          onClick={() => setSelected(items[index - 1]?.id ?? item.id)}
        >
          ‹
        </Button>
        <Button
          size="sm"
          disabled={index >= items.length - 1}
          aria-label="Lập luận sau"
          onClick={() => setSelected(items[index + 1]?.id ?? item.id)}
        >
          ›
        </Button>
        <span className={styles.dSpacer} />
        <Button size="sm" aria-label="Thu nhỏ" onClick={() => step(-1)}>
          −
        </Button>
        <span className={styles.dCount}>{zoom ? `${Math.round(zoom * 100)}%` : 'Vừa khung'}</span>
        <Button size="sm" aria-label="Phóng to" onClick={() => step(1)}>
          +
        </Button>
        <Button size="sm" variant="ghost" disabled={zoom === null} onClick={() => setZoom(null)}>
          Vừa khung
        </Button>
      </div>
      <div className={styles.dBar}>
        <Badge tone={item.importance === 'main' ? 'accent' : 'neutral'}>
          {item.importance === 'main' ? 'Luận điểm chính' : 'Luận điểm phụ'}
        </Badge>
        {state && (
          <Badge tone={state === 'confirmed' ? 'success' : 'danger'}>
            {state === 'confirmed' ? 'Đã xác nhận' : 'Đã loại'}
          </Badge>
        )}
        <span className={styles.note}>
          {view === 'toulmin'
            ? `${diagram.identified}/6 thành phần đã xác định. Ô nét đứt là thành phần chưa thấy trong bài.`
            : 'I là nội dung trong bài. RA là bước suy luận nối tiền đề với kết luận, CA là bước phản bác.'}
        </span>
        <span className={styles.dSpacer} />
        <ReviewActions
          decided={Boolean(state)}
          dismissLabel="Loại bỏ"
          onConfirm={() => onDecide(item.id, 'confirm')}
          onDismiss={() => onDecide(item.id, 'dismiss')}
          onUndo={() => onDecide(item.id, 'reopen')}
        />
      </div>
      <div className={styles.dCanvas}>
        <svg
          role="group"
          aria-label={`Lược đồ ${view === 'toulmin' ? 'Toulmin' : 'AIF'} của lập luận ${index + 1}`}
          viewBox={`${-PAD} ${-PAD} ${width} ${height}`}
          width={zoom ? width * zoom : undefined}
          className={zoom ? undefined : styles.dFit}
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className={styles.dArrow} />
            </marker>
          </defs>
          {diagram.edges.map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return null;
            const path = edgePath(from, to);
            return (
              <g key={edge.id}>
                <path
                  d={path.d}
                  className={styles.dEdge}
                  data-tone={edge.tone}
                  data-dashed={edge.dashed}
                  markerEnd="url(#arrow)"
                />
                {edge.label && (
                  <text x={path.labelX} y={path.labelY - 6} textAnchor="middle" className={styles.dLabel}>
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
          {diagram.nodes.map((node) =>
            node.kind === 'scheme' ? (
              <g key={node.id} data-testid={`node-${node.id}`}>
                <circle
                  cx={node.x + node.width / 2}
                  cy={node.y + node.height / 2}
                  r={node.width / 2}
                  className={styles.dScheme}
                  data-role={node.role}
                />
                <text
                  x={node.x + node.width / 2}
                  y={node.y + node.height / 2 - 8}
                  textAnchor="middle"
                  className={styles.dSchemeCode}
                >
                  {node.role === 'ra' ? 'RA' : 'CA'}
                </text>
                <text
                  x={node.x + node.width / 2}
                  y={node.y + node.height / 2 + 14}
                  textAnchor="middle"
                  className={styles.dLabel}
                >
                  {ROLES[node.role]}
                </text>
                {node.role === 'ra' && (
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + node.height / 2 + 32}
                    textAnchor="middle"
                    className={styles.dLabel}
                  >
                    {premises} tiền đề → 1 kết luận
                  </text>
                )}
              </g>
            ) : (
              <foreignObject
                key={node.id}
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                data-testid={`node-${node.id}`}
              >
                {card(node)}
              </foreignObject>
            ),
          )}
        </svg>
      </div>
    </div>
  );
}
