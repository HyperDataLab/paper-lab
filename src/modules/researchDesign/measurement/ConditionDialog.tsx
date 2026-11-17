import { useState } from 'react';
import type { DraftCondition } from '@/core/researchDesign/draft/schema';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { Dialog, DialogActions } from '@/shared/ui/Dialog';
import { TextField } from '@/shared/ui/TextField';
import { ParamsEditor } from '../analyses/ParamsEditor';
import styles from './Measurement.module.css';

export function ConditionDialog({
  initial,
  close,
  save,
}: {
  initial?: DraftCondition;
  close: () => void;
  save: (v: Omit<DraftCondition, 'id'>) => Promise<boolean>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [baseline, setBaseline] = useState(initial?.baseline ?? false);
  const [params, setParams] = useState(initial?.params ?? {});
  return (
    <Dialog kind="form" title="Điều kiện" description="Mô tả điều kiện chạy." onClose={close}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void save({ name, baseline, params }).then((ok) => {
            if (ok) close();
          });
        }}
      >
        <TextField label="Tên" required value={name} onChange={(e) => setName(e.target.value)} />
        <Checkbox checked={baseline} onChange={(e) => setBaseline(e.target.checked)}>
          Là baseline
        </Checkbox>
        <ParamsEditor value={params} onChange={setParams} />
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
