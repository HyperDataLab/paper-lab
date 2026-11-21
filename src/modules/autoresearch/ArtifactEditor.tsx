import { useState } from 'react';
import type { Artifact } from '@/core/autoresearch/record';
import { Button } from '@/shared/ui/Button';
import { Drawer } from '@/shared/ui/Drawer';
import { TextField } from '@/shared/ui/TextField';
import styles from './autoresearch.module.css';

export function ArtifactEditor({
  artifact,
  busy,
  error,
  close,
  save,
}: {
  artifact: Artifact;
  busy: boolean;
  error: string;
  close: () => void;
  save: (value: unknown, note: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState(() => JSON.stringify(artifact.content, null, 2));
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState(false);
  const submit = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (await save(parsed, note)) close();
  };
  return (
    <Drawer
      open
      side="right"
      size="lg"
      label="Sửa kết quả"
      title="Sửa kết quả"
      description="Lưu bản sửa để PI và Critic xem lại. Các kết quả phía sau sẽ đánh dấu là đã cũ."
      onClose={() => {
        if (!busy) close();
      }}
      footer={
        <Button variant="primary" disabled={busy || !note.trim()} onClick={() => void submit()}>
          Lưu bản sửa
        </Button>
      }
    >
      <div className={styles.stack}>
        <TextField
          label="Nội dung JSON"
          multiline
          rows={16}
          value={value}
          disabled={busy}
          error={invalid ? 'JSON chưa hợp lệ.' : undefined}
          onChange={(event) => setValue(event.target.value)}
        />
        <TextField
          label="Lý do sửa"
          multiline
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
        />
        {error && (
          <div role="alert">
            <p>Không lưu được bản sửa. Kiểm tra dữ liệu và các liên kết.</p>
            <details>
              <summary>Chi tiết kỹ thuật</summary>
              {error}
            </details>
          </div>
        )}
      </div>
    </Drawer>
  );
}
