import { useState } from 'react';
import { estimateCalls, FIELD_CATALOG } from '@/core/extraction';
import type { ExtractionMode, ExtractionProject } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { Drawer } from '@/shared/ui/Drawer';
import { OptionCard } from '@/shared/ui/OptionCard';
import { SheetNote } from '@/shared/ui/SheetNote';
import { SheetSection } from '@/shared/ui/SheetSection';
import { TextField } from '@/shared/ui/TextField';
import { ACCESS, fullExtractHelp, MODES } from './labels';
import styles from './sheets.module.css';

export interface RunChoice {
  mode: ExtractionMode;
  paperKeys: string[];
  fieldKeys: string[];
  keepVerified: boolean;
  budget: number;
  fullExtract?: boolean;
}

/** Only modes that are actually built can be chosen; the others say what they will add. */
const AVAILABLE: ExtractionMode[] = ['STANDARD', 'HIGH_QUALITY'];

/** Set up one extraction run: how thorough, which papers and columns, and the most AI calls it may spend. */
export function RunPanel({
  project,
  onClose,
  onStart,
  singlePaper = false,
}: {
  project: ExtractionProject;
  onClose: () => void;
  onStart: (choice: RunChoice) => void;
  singlePaper?: boolean;
}) {
  const visible = project.fields.filter((field) => !field.hidden);
  const [mode, setMode] = useState<ExtractionMode>('STANDARD');
  const [fullExtract, setFullExtract] = useState(false);
  const [paperKeys, setPaperKeys] = useState(() =>
    project.papers.filter((paper) => paper.screening === 'included').map((paper) => paper.key),
  );
  const [fieldKeys, setFieldKeys] = useState(() => visible.map((field) => field.key));
  const [keepVerified, setKeepVerified] = useState(true);
  const calls = estimateCalls(project, paperKeys, fieldKeys, mode);
  const [budget, setBudget] = useState(() => Math.max(calls * 2, 10));
  const selectMode = (nextMode: ExtractionMode, full: boolean) => {
    const keys = full ? FIELD_CATALOG.map((field) => field.key) : visible.map((field) => field.key);
    setMode(nextMode);
    setFullExtract(full);
    setFieldKeys(keys);
    setBudget((old) => Math.max(old, estimateCalls(project, paperKeys, keys, nextMode)));
  };
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
  const availableFields = fullExtract ? FIELD_CATALOG : visible;
  const allFields = fieldKeys.length === availableFields.length;
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
            onClick={() => onStart({ mode, paperKeys, fieldKeys, keepVerified, budget, fullExtract })}
          >
            Chạy trích xuất (AI)
          </Button>
        </>
      }
    >
      <SheetSection title="Chế độ">
        <div className={styles.modes} role="radiogroup" aria-label="Chế độ">
          {(Object.keys(MODES) as ExtractionMode[]).map((key) => {
            if (singlePaper && key === 'DEEP_RESEARCH') {
              return (
                <OptionCard
                  key="FULL_EXTRACT"
                  type="radio"
                  variant="card"
                  name="extraction-mode"
                  checked={fullExtract}
                  onChange={() => selectMode('STANDARD', true)}
                  title="Full Extract"
                  description={fullExtractHelp(FIELD_CATALOG.length)}
                />
              );
            }
            const available = AVAILABLE.includes(key);
            return (
              <OptionCard
                key={key}
                type="radio"
                variant="card"
                name="extraction-mode"
                checked={!fullExtract && mode === key}
                disabled={!available}
                onChange={() => selectMode(key, false)}
                title={MODES[key].label}
                description={
                  available ? MODES[key].help : `${MODES[key].help} Dùng trong Deep Research của project.`
                }
              />
            );
          })}
        </div>
        {fullExtract && (
          <Checkbox
            checked={mode === 'HIGH_QUALITY'}
            onChange={(event) => {
              const nextMode = event.target.checked ? 'HIGH_QUALITY' : 'STANDARD';
              setMode(nextMode);
              setBudget((old) => Math.max(old, estimateCalls(project, paperKeys, fieldKeys, nextMode)));
            }}
          >
            Kiểm chứng từng ô (High Quality)
          </Checkbox>
        )}
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
            Cột ({fieldKeys.length}/{availableFields.length})
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFieldKeys(allFields ? [] : availableFields.map((field) => field.key))}
            >
              {allFields ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
            </Button>
          </span>
        }
      >
        {(fullExtract ? [...new Set(availableFields.map((field) => field.group))] : [null]).map((group) => (
          <div key={group ?? 'fields'}>
            {group && <h4>{group}</h4>}
            <ul className={`${styles.checks} ${styles.twoColumns}`}>
              {availableFields
                .filter((field) => !group || field.group === group)
                .map((field) => (
                  <li key={field.key}>
                    <Checkbox
                      checked={fieldKeys.includes(field.key)}
                      onChange={(event) =>
                        setFieldKeys((old) => toggle(old, field.key, event.target.checked))
                      }
                    >
                      {field.label}
                    </Checkbox>
                  </li>
                ))}
            </ul>
          </div>
        ))}
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
