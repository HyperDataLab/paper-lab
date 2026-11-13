import { useState, type ReactNode } from 'react';
import type { Paper, Section } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/TextField';
import { SectionPicker } from './SectionPicker';
import { mainBodySections } from './paperScope';
import styles from './page.module.css';

export function ScopeWarning({
  paper,
  sections,
  onSections,
}: {
  paper: Paper;
  sections: string[];
  onSections: (ids: string[]) => void;
}) {
  const main = mainBodySections(paper);
  if (!main.some((id) => !sections.includes(id))) return null;
  return (
    <p>
      Phạm vi đang là {sections.length}/{paper.sections.length} mục —{' '}
      <Button size="sm" variant="ghost" onClick={() => onSections(main)}>
        Đặt lại Phần chính
      </Button>
    </p>
  );
}

/**
 * What an analysis needs before it runs, with every choice already made: the paper's remembered section
 * scope and the call ceiling from Settings. One button starts it; the choices sit behind "Tuỳ chọn".
 */
export function RunSetup({
  paper,
  sections,
  onSections,
  count,
  unit = 'đoạn',
  estimate,
  budget,
  onBudget,
  budgetLabel = 'Trần số lượt gọi',
  running = false,
  disabled = false,
  onStart,
  startLabel = 'Bắt đầu phân tích',
  summary,
  children,
}: {
  paper: Paper;
  sections: string[];
  onSections: (ids: string[]) => void;
  /** How many items a section contributes to this analysis. */
  count: (section: Section) => number;
  unit?: string;
  estimate: number;
  budget: number;
  onBudget: (value: string) => void;
  budgetLabel?: string;
  running?: boolean;
  disabled?: boolean;
  onStart: () => void;
  startLabel?: string;
  /** Extra facts for the summary line, such as how many AI steps are selected. */
  summary?: ReactNode;
  /** Extra options specific to one analysis. */
  children?: ReactNode;
}) {
  const chosen = paper.sections.filter((section) => sections.includes(section.id) && count(section) > 0);
  const [open, setOpen] = useState(chosen.length === 0);
  const over = estimate > budget;
  return (
    <div className={styles.runSetup}>
      <p className={styles.runSummary}>
        Phạm vi: <strong>{chosen.length} mục</strong>
        {summary}
      </p>
      <div className={styles.runActions}>
        <Button variant="primary" disabled={disabled || running || over || !chosen.length} onClick={onStart}>
          {startLabel}
        </Button>
        <span className={styles.muted}>
          ~{estimate} lượt · trần {budget} (chưa tính thử lại)
        </span>
        <Button variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Ẩn tuỳ chọn' : 'Tuỳ chọn'}
        </Button>
      </div>
      <ScopeWarning paper={paper} sections={sections} onSections={onSections} />
      {over && (
        <p role="alert">Ước tính vượt trần số lượt gọi. Nâng trần trong Tuỳ chọn hoặc trong Cài đặt.</p>
      )}
      {open && (
        <div className={styles.runOptions}>
          <p>Phạm vi này dùng chung cho mọi phân tích của bài.</p>
          <SectionPicker
            paper={paper}
            value={sections}
            onChange={onSections}
            disabled={running}
            legend="Mục được gửi cho AI"
            count={count}
            unit={unit}
          />
          <div className={styles.setupSide}>
            {children}
            <TextField
              label={budgetLabel}
              type="number"
              min={0}
              step={1}
              value={String(budget)}
              disabled={running}
              onChange={(event) => onBudget(event.target.value)}
            />
            <p className={styles.muted}>
              Các mục đã chọn được nhớ cho bài này và dùng chung cho mọi phân tích. Trần mặc định đặt trong
              Cài đặt, mục Giới hạn chạy.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
