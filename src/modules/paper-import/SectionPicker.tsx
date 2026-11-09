import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildSectionTree, subtreeIds, type SectionNode } from '@/core/paper';
import type { Paper, Section } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { IconButton } from '@/shared/ui/IconButton';
import { SECTION_ROLE_LABELS } from './sectionRoles';
import styles from './page.module.css';

const isMainBody = (section: Section) =>
  !['references', 'appendix'].includes(section.role) && !/^(front matter|acknowledg)/i.test(section.heading);

/** Chooses sections through the paper's outline, so a long paper is a short list until a branch is opened. */
export function SectionPicker({
  paper,
  value,
  onChange,
  count,
  disabled = false,
  legend = 'Chọn mục',
  unit = 'đoạn',
}: {
  paper: Paper;
  value: string[];
  onChange: (ids: string[]) => void;
  /** How many items a section contributes; sections at 0 cannot be analysed on their own. */
  count: (section: Section) => number;
  disabled?: boolean;
  legend?: string;
  unit?: string;
}) {
  const tree = useMemo(() => buildSectionTree(paper.sections), [paper.sections]);
  const [open, setOpen] = useState<string[]>([]);
  const selected = new Set(value);
  const useful = paper.sections.filter((section) => count(section) > 0);
  const chosen = useful.filter((section) => selected.has(section.id));
  const items = chosen.reduce((sum, section) => sum + count(section), 0);
  const usefulIds = new Set(useful.map((section) => section.id));

  function renderNode(node: SectionNode) {
    const ids = subtreeIds(node).filter((id) => usefulIds.has(id));
    const on = ids.filter((id) => selected.has(id));
    const total = paper.sections
      .filter((section) => ids.includes(section.id))
      .reduce((sum, section) => sum + count(section), 0);
    const hasChildren = node.children.length > 0;
    const isOpen = open.includes(node.section.id);
    const { section } = node;
    return (
      <li key={section.id}>
        <div className={styles.pickerRow}>
          {hasChildren ? (
            <IconButton
              size="sm"
              label={`${isOpen ? 'Thu gọn' : 'Mở'} ${section.heading}`}
              aria-expanded={isOpen}
              onClick={() =>
                setOpen((old) => (isOpen ? old.filter((id) => id !== section.id) : [...old, section.id]))
              }
            >
              <ChevronRight size={14} className={isOpen ? styles.chevronOpen : undefined} />
            </IconButton>
          ) : (
            <span className={styles.pickerSpacer} aria-hidden="true" />
          )}
          <Checkbox
            checked={ids.length > 0 && on.length === ids.length}
            indeterminate={on.length > 0 && on.length < ids.length}
            disabled={ids.length === 0}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...new Set([...value, ...ids])]
                  : value.filter((id) => !ids.includes(id)),
              )
            }
          >
            {section.heading} ({total} {unit})
          </Checkbox>
          {section.role !== 'other' && <Badge>{SECTION_ROLE_LABELS[section.role]}</Badge>}
        </div>
        {hasChildren && isOpen && <ul className={styles.pickerList}>{node.children.map(renderNode)}</ul>}
      </li>
    );
  }
  return (
    <fieldset disabled={disabled} className={styles.picker}>
      <legend>{legend}</legend>
      <div className={styles.pickerBar}>
        <span>
          Đã chọn {chosen.length}/{useful.length} mục · {items} {unit}
        </span>
        <Button size="sm" variant="ghost" onClick={() => onChange(useful.map((section) => section.id))}>
          Chọn tất cả
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange(useful.filter(isMainBody).map((section) => section.id))}
        >
          Phần chính
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onChange([])}>
          Bỏ chọn
        </Button>
      </div>
      <ul className={`${styles.pickerList} ${styles.pickerScroll}`}>{tree.map(renderNode)}</ul>
    </fieldset>
  );
}
