import { useState } from 'react';
import { estimateCalls } from '@/core/extraction';
import type { ExtractionMode, ExtractionProject } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { Drawer } from '@/shared/ui/Drawer';
import { OptionCard } from '@/shared/ui/OptionCard';
import { SheetNote } from '@/shared/ui/SheetNote';
import { SheetSection } from '@/shared/ui/SheetSection';
import { TextField } from '@/shared/ui/TextField';
import { ACCESS, MODES } from './labels';
import styles from './sheets.module.css';

export interface RunChoice {
  mode: ExtractionMode;
  paperKeys: string[];
  fieldKeys: string[];
  keepVerified: boolean;
  budget: number;
}

/** Only modes that are actually built can be chosen; the others say what they will add. */
const AVAILABLE: ExtractionMode[] = ['STANDARD', 'HIGH_QUALITY'];

/** Set up one extraction run: how thorough, which papers and columns, and the most AI calls it may spend. */
export function RunPanel({
  project,
  onClose,
  onStart,
}: {
  project: ExtractionProject;
  onClose: () => void;
  onStart: (choice: RunChoice) => void;
}) {
  const visible = project.fields.filter((field) => !field.hidden);
  const [mode, setMode] = useState<ExtractionMode>('STANDARD');
  const [paperKeys, setPaperKeys] = useState(() =>
    project.papers.filter((paper) => paper.screening === 'included').map((paper) => paper.key),
  );
  const [fieldKeys, setFieldKeys] = useState(() => visible.map((field) => field.key));
  const [keepVerified, setKeepVerified] = useState(true);
  const calls = estimateCalls(project, paperKeys, fieldKeys, mode);
  const [budget, setBudget] = useState(() => Math.max(calls * 2, 10));
  const toggle = (list: string[], key: string, on: boolean) =>
    on ? [...list, key] : list.filter((item) => item !== key);
  const access = Object.entries(ACCESS)
    .map(
      ([key, label]) =>
        [
          label,
          project.papers.filter((paper) => paperKeys.includes(paper.key) && paper.access === key).length,
        ] as const,
    )
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${count} ${label.toLowerCase()}`)
    .join(', ');
  const allFields = fieldKeys.length === visible.length;
  return (
    <Drawer
      open
      onClose={onClose}
      label="Chạy trích xuất"
      side="right"
      title="Chạy trích xuất"
      description="AI đọc bài và điền từng ô, kèm đoạn trích làm bằng chứng. Ô nào không tìm được nguồn sẽ để trống."
      footer={
        <>
          <SheetNote>
            {paperKeys.length * fieldKeys.length} ô · ước tính {calls} lượt gọi AI
            {access ? ` · ${access}` : ''}
          </SheetNote>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            variant="primary"
            disabled={!calls || calls > budget}
            onClick={() => onStart({ mode, paperKeys, fieldKeys, keepVerified, budget })}
          >
            Chạy trích xuất (AI)
          </Button>
        </>
      }
    >
      <SheetSection title="Chế độ">
        <div className={styles.modes} role="radiogroup" aria-label="Chế độ">
          {(Object.keys(MODES) as ExtractionMode[]).map((key) => {
            const available = AVAILABLE.includes(key);
            return (
              <OptionCard
                key={key}
                type="radio"
                variant="card"
                name="extraction-mode"
                checked={mode === key}
                disabled={!available}
                onChange={() => setMode(key)}
                title={MODES[key].label}
                description={
                  available ? MODES[key].help : `${MODES[key].help} Dùng trong Deep Research của project.`
                }
              />
            );
          })}
        </div>
      </SheetSection>

      {project.papers.length > 1 && (
        <SheetSection title={`Bài (${paperKeys.length}/${project.papers.length})`}>
          <ul className={styles.checks}>
            {project.papers.map((paper) => (
              <li key={paper.key}>
                <Checkbox
                  checked={paperKeys.includes(paper.key)}
                  onChange={(event) => setPaperKeys((old) => toggle(old, paper.key, event.target.checked))}
                >
                  {paper.title} · {ACCESS[paper.access]}
                </Checkbox>
              </li>
            ))}
          </ul>
        </SheetSection>
      )}

      <SheetSection
        title={
          <span className={styles.sectionHead}>
            Cột ({fieldKeys.length}/{visible.length})
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFieldKeys(allFields ? [] : visible.map((field) => field.key))}
            >
              {allFields ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
            </Button>
          </span>
        }
      >
        <ul className={`${styles.checks} ${styles.twoColumns}`}>
          {visible.map((field) => (
            <li key={field.key}>
              <Checkbox
                checked={fieldKeys.includes(field.key)}
                onChange={(event) => setFieldKeys((old) => toggle(old, field.key, event.target.checked))}
              >
                {field.label}
              </Checkbox>
            </li>
          ))}
        </ul>
      </SheetSection>

      <SheetSection title="Tuỳ chọn">
        <Checkbox checked={keepVerified} onChange={(event) => setKeepVerified(event.target.checked)}>
          Giữ nguyên các ô đã xác nhận
        </Checkbox>
        <div className={styles.budget}>
          <TextField
            label="Trần số lượt gọi"
            hint="Lượt chạy dừng lại khi chạm trần này."
            type="number"
            min={1}
            value={String(budget)}
            onChange={(event) => setBudget(Number(event.target.value))}
          />
        </div>
        {calls > budget && <p role="alert">Ước tính vượt trần số lượt gọi.</p>}
      </SheetSection>
    </Drawer>
  );
}
