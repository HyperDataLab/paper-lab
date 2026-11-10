import { useState } from 'react';
import { estimateCalls } from '@/core/extraction';
import type { ExtractionMode, ExtractionProject } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { Drawer } from '@/shared/ui/Drawer';
import { TextField } from '@/shared/ui/TextField';
import { Wizard } from '@/shared/ui/Wizard';
import { ACCESS, MODES } from './labels';
import styles from './extraction.module.css';

export interface RunChoice {
  mode: ExtractionMode;
  paperKeys: string[];
  fieldKeys: string[];
  keepVerified: boolean;
  budget: number;
}

/** Only modes that are actually built can be chosen; the others say what they will add. */
const AVAILABLE: ExtractionMode[] = ['STANDARD'];

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
  const calls = estimateCalls(project, paperKeys, fieldKeys);
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
  return (
    <Drawer open onClose={onClose} label="Chạy trích xuất" side="right">
      <div className={styles.drawer}>
        <header className={styles.drawerHead}>
          <h2>Chạy trích xuất</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Đóng
          </Button>
        </header>
        <Wizard
          label="Các bước chạy trích xuất"
          finishLabel="Chạy trích xuất (AI)"
          finishDisabled={!calls || calls > budget}
          onFinish={() => onStart({ mode, paperKeys, fieldKeys, keepVerified, budget })}
          note={`${paperKeys.length * fieldKeys.length} ô · ước tính ${calls} lượt gọi AI${access ? ` · ${access}` : ''}`}
          steps={[
            {
              id: 'mode',
              title: 'Chế độ',
              summary: MODES[mode].label,
              content: (
                <fieldset className={styles.modes}>
                  <legend>Chế độ</legend>
                  {(Object.keys(MODES) as ExtractionMode[]).map((key) => (
                    <Checkbox
                      key={key}
                      checked={mode === key}
                      disabled={!AVAILABLE.includes(key)}
                      onChange={() => setMode(key)}
                    >
                      {MODES[key].label}
                      {!AVAILABLE.includes(key) && ' · Sắp có'} · {MODES[key].help}
                    </Checkbox>
                  ))}
                </fieldset>
              ),
            },
            {
              id: 'scope',
              title: 'Bài và cột',
              summary: `${paperKeys.length} bài · ${fieldKeys.length} cột`,
              ready: calls > 0,
              content: (
                <>
                  <fieldset>
                    <legend>Bài</legend>
                    {project.papers.map((paper) => (
                      <Checkbox
                        key={paper.key}
                        checked={paperKeys.includes(paper.key)}
                        onChange={(event) =>
                          setPaperKeys((old) => toggle(old, paper.key, event.target.checked))
                        }
                      >
                        {paper.title} · {ACCESS[paper.access]}
                      </Checkbox>
                    ))}
                  </fieldset>
                  <fieldset>
                    <legend>Cột</legend>
                    {visible.map((field) => (
                      <Checkbox
                        key={field.key}
                        checked={fieldKeys.includes(field.key)}
                        onChange={(event) =>
                          setFieldKeys((old) => toggle(old, field.key, event.target.checked))
                        }
                      >
                        {field.label}
                      </Checkbox>
                    ))}
                  </fieldset>
                </>
              ),
            },
            {
              id: 'confirm',
              title: 'Xác nhận và chạy',
              content: (
                <>
                  <Checkbox
                    checked={keepVerified}
                    onChange={(event) => setKeepVerified(event.target.checked)}
                  >
                    Giữ nguyên các ô đã xác nhận
                  </Checkbox>
                  <TextField
                    label="Trần số lượt gọi"
                    type="number"
                    min={1}
                    value={String(budget)}
                    onChange={(event) => setBudget(Number(event.target.value))}
                  />
                  {calls > budget && <p role="alert">Ước tính vượt trần số lượt gọi.</p>}
                </>
              ),
            },
          ]}
        />
      </div>
    </Drawer>
  );
}
