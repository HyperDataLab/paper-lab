import { useState } from 'react';
import type { DraftDataset } from '@/core/researchDesign/draft/schema';
import { Button } from '@/shared/ui/Button';
import { Dialog, DialogActions } from '@/shared/ui/Dialog';
import { TextField } from '@/shared/ui/TextField';
import styles from './Measurement.module.css';

export type DatasetInput = Omit<DraftDataset, 'id'>;

const optionalFields = { version: 'Phiên bản', split: 'Split', sha256: 'SHA-256' } as const;

export function DatasetDialog({
  initial,
  close,
  save,
}: {
  initial: DatasetInput;
  close: () => void;
  save: (v: DatasetInput) => Promise<boolean>;
}) {
  const [v, set] = useState(initial);
  return (
    <Dialog kind="form" title="Dataset" description="Mô tả dataset." onClose={close}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void save(v).then((ok) => {
            if (ok) close();
          });
        }}
      >
        <TextField
          label="Tên"
          required
          value={v.name}
          onChange={(e) => set({ ...v, name: e.target.value })}
        />
        <TextField label="Nguồn" value={v.source} onChange={(e) => set({ ...v, source: e.target.value })} />
        {(Object.keys(optionalFields) as (keyof typeof optionalFields)[]).map((field) => (
          <TextField
            key={field}
            label={optionalFields[field]}
            value={v[field] ?? ''}
            onChange={(e) => set({ ...v, [field]: e.target.value || null })}
          />
        ))}
        <DialogActions>
          <Button onClick={close}>Hủy</Button>
          <Button type="submit" variant="primary">
            Lưu
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
