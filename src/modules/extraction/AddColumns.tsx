import { useState } from 'react';
import { customField, FIELD_CATALOG, FIELD_TEMPLATES } from '@/core/extraction';
import type { ExtractionProject, FieldDefinition } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { Chip } from '@/shared/ui/Chip';
import { Drawer } from '@/shared/ui/Drawer';
import { TextField } from '@/shared/ui/TextField';
import styles from './extraction.module.css';

const GROUPS = [...new Set(FIELD_CATALOG.map((field) => field.group))];

export function AddColumns({
  project,
  onClose,
  onAdd,
}: {
  project: ExtractionProject;
  onClose: () => void;
  onAdd: (fields: FieldDefinition[]) => void;
}) {
  const has = (key: string) => project.fields.some((field) => field.key === key);
  const [chosen, setChosen] = useState<string[]>([]);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [instruction, setInstruction] = useState('');
  const toggle = (key: string, on: boolean) =>
    setChosen((old) => (on ? [...old, key] : old.filter((item) => item !== key)));
  return (
    <Drawer open onClose={onClose} label="Thêm cột" side="right">
      <div className={styles.drawer}>
        <header className={styles.drawerHead}>
          <h2>Thêm cột</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Đóng
          </Button>
        </header>
        <section>
          <h3>Mẫu theo loại bài</h3>
          <div className={styles.chips}>
            {FIELD_TEMPLATES.map((template) => (
              <Chip
                key={template.id}
                onClick={() =>
                  setChosen((old) => [...new Set([...old, ...template.keys.filter((key) => !has(key))])])
                }
              >
                {template.label}
              </Chip>
            ))}
          </div>
        </section>
        <section>
          <h3>Cột gợi ý</h3>
          {GROUPS.map((group) => (
            <details key={group} open={group === 'Summary' || group === 'Methodology' || group === 'Results'}>
              <summary>{group}</summary>
              {FIELD_CATALOG.filter((field) => field.group === group).map((field) => (
                <Checkbox
                  key={field.key}
                  disabled={has(field.key)}
                  checked={has(field.key) || chosen.includes(field.key)}
                  onChange={(event) => toggle(field.key, event.target.checked)}
                >
                  {field.label} · {field.description}
                </Checkbox>
              ))}
            </details>
          ))}
          <div className={styles.actions}>
            <Button
              variant="primary"
              disabled={!chosen.length}
              onClick={() => {
                onAdd(FIELD_CATALOG.filter((field) => chosen.includes(field.key)));
                onClose();
              }}
            >
              Thêm {chosen.length} cột
            </Button>
          </div>
        </section>
        <section>
          <h3>Cột tự định nghĩa</h3>
          <div className={styles.form}>
            <TextField label="Tên cột" value={label} onChange={(event) => setLabel(event.target.value)} />
            <TextField
              label="Mô tả"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <TextField
              label="Hướng dẫn trích (không bắt buộc)"
              hint="Nói rõ cần lấy gì và điều gì không được suy ra."
              multiline
              rows={3}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
            />
            <div>
              <Button
                disabled={!label.trim()}
                onClick={() => {
                  onAdd([
                    customField({
                      label,
                      description,
                      instruction,
                      existing: project.fields.map((field) => field.key),
                    }),
                  ]);
                  onClose();
                }}
              >
                Tạo cột
              </Button>
            </div>
          </div>
        </section>
      </div>
    </Drawer>
  );
}
