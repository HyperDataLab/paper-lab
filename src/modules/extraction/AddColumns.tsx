import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { customField, FIELD_CATALOG, FIELD_TEMPLATES, MAX_COLUMNS } from '@/core/extraction';
import type { ExtractionProject, FieldDefinition } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { Chip } from '@/shared/ui/Chip';
import { Drawer } from '@/shared/ui/Drawer';
import { OptionCard } from '@/shared/ui/OptionCard';
import { SheetNote } from '@/shared/ui/SheetNote';
import { SheetSection } from '@/shared/ui/SheetSection';
import { TextField } from '@/shared/ui/TextField';
import { FIELD_HINTS } from './labels';
import styles from './sheets.module.css';

const GROUPS = [...new Set(FIELD_CATALOG.map((field) => field.group))];
const OPEN_GROUPS = ['Summary', 'Methodology', 'Results'];

/** Choose the columns of the matrix: a template by paper type, fields from the catalogue, or one of your own. */
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
  const remaining = Math.max(0, MAX_COLUMNS - project.fields.length);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [instruction, setInstruction] = useState('');
  const toggle = (key: string, on: boolean) =>
    setChosen((old) => (on ? [...old, key] : old.filter((item) => item !== key)));
  return (
    <Drawer
      open
      onClose={onClose}
      label="Thêm cột"
      side="right"
      size="lg"
      title="Thêm cột"
      description={`Còn ${remaining} chỗ trong ${MAX_COLUMNS} cột (kể cả cột ẩn). Mỗi cột là một thông tin AI sẽ trích từ bài, kèm trích dẫn.`}
      footer={
        <>
          <SheetNote>{chosen.length ? `Đã chọn ${chosen.length} cột` : 'Chưa chọn cột nào'}</SheetNote>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
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
        </>
      }
    >
      <SheetSection title="Mẫu theo loại bài">
        <p className={styles.hint}>Chọn một mẫu để đánh dấu sẵn các cột hay dùng cho loại bài đó.</p>
        <div className={styles.chips}>
          {FIELD_TEMPLATES.map((template) => (
            <Chip
              key={template.id}
              disabled={chosen.length >= remaining}
              onClick={() =>
                setChosen((old) =>
                  [...new Set([...old, ...template.keys.filter((key) => !has(key))])].slice(0, remaining),
                )
              }
            >
              {template.label}
            </Chip>
          ))}
        </div>
      </SheetSection>

      <SheetSection title="Cột gợi ý">
        <div className={styles.groups}>
          {GROUPS.map((group) => {
            const fields = FIELD_CATALOG.filter((field) => field.group === group);
            const picked = fields.filter((field) => chosen.includes(field.key)).length;
            const present = fields.filter((field) => has(field.key)).length;
            return (
              <details key={group} className={styles.group} open={OPEN_GROUPS.includes(group)}>
                <summary>
                  <ChevronRight size={16} className={styles.chevron} aria-hidden="true" />
                  <span className={styles.groupName}>{group}</span>
                  <span className={styles.groupCount}>
                    {picked > 0 && <span className={styles.picked}>{picked} đã chọn</span>}
                    {present > 0 && `${present} có sẵn`}
                    {!picked && !present && `${fields.length} cột`}
                  </span>
                </summary>
                <ul className={styles.options}>
                  {fields.map((field) => {
                    const exists = has(field.key);
                    const on = exists || chosen.includes(field.key);
                    return (
                      <li key={field.key}>
                        <OptionCard
                          checked={on}
                          disabled={exists || (!chosen.includes(field.key) && chosen.length >= remaining)}
                          onChange={(value) => toggle(field.key, value)}
                          title={field.label}
                          description={
                            exists ? 'Đã có trong bảng' : (FIELD_HINTS[field.key] ?? field.description)
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </div>
      </SheetSection>

      <SheetSection title="Cột tự định nghĩa">
        <div className={styles.custom}>
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
              disabled={!label.trim() || remaining === 0}
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
      </SheetSection>
    </Drawer>
  );
}
