import { useEffect, useRef } from 'react';
import type { Criterion, PaperMark } from '@/core/paperFindings';
import type { Finding, Paper } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { Select } from '@/shared/ui/Select';
import { MarkedText } from './MarkedText';
import { PaperTableView } from './PaperTableView';
import { LayerChips, MarkGutter } from './ReaderMarks';
import styles from './page.module.css';

type Location = Finding['locations'][number];

/**
 * The paper beside the analysis: one section at a time, with the passage an analysis points to marked and
 * scrolled into view. Reading only; editing roles and per-paragraph actions stay in the full reader.
 */
export function ReadingPane({
  paper,
  selected,
  onSelect,
  highlight,
  onOpenFull,
  marks = [],
  layers = [],
  onLayers,
  onMark,
}: {
  paper: Paper;
  selected: string;
  onSelect: (id: string) => void;
  highlight: Location | null;
  onOpenFull: () => void;
  /** Everything marked on the paper; the pane shows the layers that are switched on. */
  marks?: PaperMark[];
  layers?: Criterion[];
  onLayers?: (layers: Criterion[]) => void;
  onMark?: (mark: PaperMark) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const index = paper.sections.findIndex((item) => item.id === selected);
  const section = paper.sections[index];
  const previous = paper.sections[index - 1];
  const next = paper.sections[index + 1];
  const paragraphs = paper.paragraphs
    .filter((item) => item.sectionId === selected)
    .sort((a, b) => a.order - b.order);
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const target = highlight && root.querySelector(`[data-paragraph="${CSS.escape(highlight.paragraphId)}"]`);
    if (target) target.scrollIntoView?.({ block: 'center' });
    else root.scrollTop = 0;
  }, [highlight, selected]);
  return (
    <aside className={styles.pane} aria-label="Bài báo">
      <div className={styles.paneHead}>
        <Select
          label="Mục đang đọc"
          size="sm"
          value={selected}
          onChange={(event) => onSelect(event.target.value)}
        >
          {paper.sections.map((item) => (
            <option key={item.id} value={item.id}>
              {`${' '.repeat(Math.max(0, item.level - 1))}${item.heading}`}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="ghost" onClick={onOpenFull}>
          Mở rộng
        </Button>
      </div>
      {onLayers && <LayerChips marks={marks} layers={layers} onLayers={onLayers} />}
      <div ref={scroller} className={styles.paneBody} tabIndex={0}>
        {!section ? (
          <p className={styles.muted}>Không có mục nào.</p>
        ) : paragraphs.length === 0 ? (
          <p className={styles.muted}>Mục này không có đoạn riêng; nội dung nằm trong các mục con.</p>
        ) : (
          paragraphs.map((item) => {
            const marked = highlight?.paragraphId === item.id ? highlight : null;
            const own = marks.filter(
              (mark) => mark.paragraphId === item.id && layers.includes(mark.criterion),
            );
            return (
              <div
                key={item.id}
                data-paragraph={item.id}
                className={`${styles.paneParagraph} ${item.kind === 'body' || item.kind === 'table' ? '' : styles.muted}`}
              >
                {item.table && (
                  <PaperTableView
                    table={item.table}
                    caption={paper.paragraphs.find((other) => other.id === item.table?.captionId)}
                  />
                )}
                {(!item.table || marked) && (
                  <div className={styles.markedRow}>
                    <MarkGutter marks={own} />
                    <p className={styles.reading}>
                      <MarkedText text={item.text} marks={own} selected={marked} onMark={onMark} />
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className={styles.sectionNav}>
        <Button
          size="sm"
          variant="ghost"
          disabled={!previous}
          onClick={() => previous && onSelect(previous.id)}
        >
          ← Mục trước
        </Button>
        <Button size="sm" variant="ghost" disabled={!next} onClick={() => next && onSelect(next.id)}>
          Mục sau →
        </Button>
      </div>
    </aside>
  );
}
