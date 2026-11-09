import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildSectionTree, type SectionNode } from '@/core/paper';
import { SectionSchema, type Finding, type Paper, type PaperParagraph, type Section } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { Tree, type TreeNode } from '@/shared/ui/Tree';
import { BatchParagraphStatus } from './BatchParagraphStatus';
import { PaperTableView } from './PaperTableView';
import { SECTION_ROLE_LABELS } from './sectionRoles';
import styles from './page.module.css';
import type { useBatchRun } from './useBatchRun';

const KIND_LABELS: Record<PaperParagraph['kind'], string | null> = {
  body: null,
  caption: 'Chú thích hình/bảng',
  equation: 'Công thức',
  list: 'Danh sách',
  reference: 'Tài liệu tham khảo',
  heading_like: 'Tiêu đề',
  footnote: 'Chú thích chân trang',
  table: 'Bảng',
};
const RUN_KINDS: PaperParagraph['kind'][] = ['list', 'equation', 'footnote', 'reference', 'heading_like'];
const RUN_MIN = 4;

type Location = Finding['locations'][number];
type Block = { kind: 'one'; item: PaperParagraph } | { kind: 'run'; items: PaperParagraph[] };

/** Long runs of list items or equations fold into one row so body text stays readable. */
function toBlocks(items: PaperParagraph[]): Block[] {
  const blocks: Block[] = [];
  let run: PaperParagraph[] = [];
  const close = () => {
    if (run.length >= RUN_MIN) blocks.push({ kind: 'run', items: run });
    else blocks.push(...run.map((item) => ({ kind: 'one' as const, item })));
    run = [];
  };
  for (const item of items) {
    if (RUN_KINDS.includes(item.kind) && (!run.length || run[0]?.kind === item.kind)) run.push(item);
    else {
      close();
      if (RUN_KINDS.includes(item.kind)) run.push(item);
      else blocks.push({ kind: 'one', item });
    }
  }
  close();
  return blocks;
}

export function PaperReader({
  paper,
  selected,
  onSelect,
  filter,
  onClearFilter,
  highlight,
  candidateCounts,
  batch,
  onEditRole,
}: {
  paper: Paper;
  selected: string;
  onSelect: (id: string) => void;
  filter: string[] | null;
  onClearFilter: () => void;
  highlight: Location | null;
  candidateCounts: Record<string, number>;
  batch: ReturnType<typeof useBatchRun>;
  onEditRole: (role: Section['role']) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const counts = useMemo(() => {
    const own = new Map<string, number>();
    for (const paragraph of paper.paragraphs)
      if (paragraph.kind === 'body') own.set(paragraph.sectionId, (own.get(paragraph.sectionId) ?? 0) + 1);
    return own;
  }, [paper.paragraphs]);
  const outline = useMemo(() => buildSectionTree(paper.sections), [paper.sections]);
  const nodes = useMemo(() => {
    const total = (node: SectionNode): number =>
      (counts.get(node.section.id) ?? 0) + node.children.reduce((sum, child) => sum + total(child), 0);
    const toNode = (node: SectionNode): TreeNode => ({
      id: node.section.id,
      label: node.section.heading,
      meta: total(node),
      children: node.children.map(toNode),
    });
    const term = query.trim().toLowerCase();
    if (term)
      return paper.sections
        .filter((section) => section.heading.toLowerCase().includes(term))
        .map((section) => ({
          id: section.id,
          label: section.heading,
          meta: counts.get(section.id) ?? 0,
        }));
    return outline.map(toNode);
  }, [counts, outline, paper.sections, query]);

  const section = paper.sections.find((item) => item.id === selected);
  const paragraphs = paper.paragraphs.filter(
    (item) => item.sectionId === selected && (!filter || filter.includes(item.id)),
  );
  const index = paper.sections.findIndex((item) => item.id === selected);
  const previous = paper.sections[index - 1];
  const next = paper.sections[index + 1];

  function renderParagraph(item: PaperParagraph): ReactNode {
    const kindLabel = KIND_LABELS[item.kind];
    const batchItem = batch.run?.items.find((entry) => entry.paragraphId === item.id);
    const marked = highlight?.paragraphId === item.id ? highlight : null;
    return (
      <div
        key={item.id}
        id={`paper-paragraph-${item.id}`}
        title={item.id}
        className={`${styles.paragraph} ${['caption', 'equation', 'reference', 'footnote'].includes(item.kind) ? styles.muted : ''}`}
      >
        {kindLabel && <Badge>{kindLabel}</Badge>}
        {item.table ? (
          <PaperTableView
            table={item.table}
            caption={paper.paragraphs.find((p) => p.id === item.table?.captionId)}
          />
        ) : null}
        <p className={item.table && !marked ? styles.hidden : styles.reading}>
          {marked ? (
            <>
              {Array.from(item.text).slice(0, marked.start).join('')}
              <mark>{Array.from(item.text).slice(marked.start, marked.end).join('')}</mark>
              {Array.from(item.text).slice(marked.end).join('')}
            </>
          ) : (
            item.text
          )}
        </p>
        <BatchParagraphStatus
          item={batchItem}
          analysis={batch.analyses.find((entry) => entry.id === batchItem?.analysisId)}
          retry={() => batch.retry(item.id)}
          busy={batch.run?.status === 'running'}
        />
        {item.kind === 'body' && (
          <div className={styles.paragraphActions}>
            {candidateCounts[item.id] !== undefined && (
              <span>{candidateCounts[item.id]} ứng viên cục bộ</span>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate('/evaluate', { state: { prefill: item.text } })}
            >
              Đánh giá đoạn này
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.reader}>
      <div className={styles.readerNav}>
        <Card padding="md">
          <TextField
            label="Tìm mục"
            size="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {nodes.length ? (
            <Tree label="Mục lục bài báo" nodes={nodes} selectedId={selected} onSelect={onSelect} />
          ) : (
            <p>Không có mục nào khớp.</p>
          )}
        </Card>
      </div>
      <Card>
        {filter && (
          <div className={styles.filterBar}>
            Đang lọc {filter.length} đoạn.{' '}
            <Button size="sm" onClick={onClearFilter}>
              Bỏ lọc
            </Button>
          </div>
        )}
        {section ? (
          <>
            <div className={styles.sectionHead}>
              <h2>{section.heading}</h2>
              <Select
                label="Vai trò của mục"
                size="sm"
                value={section.role}
                onChange={(event) => onEditRole(event.target.value as Section['role'])}
              >
                {SectionSchema.shape.role.options.map((role) => (
                  <option key={role} value={role} title={role}>
                    {SECTION_ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
            </div>
            {paragraphs.length === 0 && (
              <p className={styles.muted}>
                {paper.sections[index + 1] && paper.sections[index + 1]!.level > section.level
                  ? 'Mục này không có đoạn riêng; nội dung nằm trong các mục con ở mục lục.'
                  : 'Không có đoạn nào trong mục này.'}
              </p>
            )}
            {toBlocks(paragraphs).map((block) =>
              block.kind === 'one' ? (
                renderParagraph(block.item)
              ) : (
                <details
                  key={block.items[0]?.id}
                  className={styles.run}
                  open={block.items.some((item) => item.id === highlight?.paragraphId)}
                >
                  <summary>
                    {block.items.length} mục: {KIND_LABELS[block.items[0]?.kind ?? 'list']}
                  </summary>
                  {block.items.map(renderParagraph)}
                </details>
              ),
            )}
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
          </>
        ) : (
          <p>Không có mục nào.</p>
        )}
      </Card>
    </div>
  );
}
