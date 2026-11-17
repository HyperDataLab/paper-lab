import { useState } from 'react';
import { bankProtocols } from '@/core/researchDesign/bank/readSnapshot';
import type { BankDoc } from '@/core/researchDesign/bank/snapshot';
import type { DraftMetric } from '@/core/researchDesign/draft/schema';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Dialog, DialogActions } from '@/shared/ui/Dialog';
import { OptionCard } from '@/shared/ui/OptionCard';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { word } from './words';
import styles from './Measurement.module.css';

export type MetricInput = Omit<DraftMetric, 'id'>;

export function MetricDialog({
  initial,
  bank,
  close,
  save,
}: {
  initial: MetricInput;
  bank: BankDoc | null;
  close: () => void;
  save: (v: MetricInput) => Promise<boolean>;
}) {
  const [v, set] = useState(initial);
  // Bank procedures are shown, never copied: the person opts in and the draft keeps only the reference.
  const procedures =
    bank && v.bank ? bankProtocols(bank).filter((p) => p.metrics.includes(v.bank?.id ?? '')) : [];
  return (
    <Dialog kind="form" title="Metric" description="Mô tả cách đo trong nghiên cứu." onClose={close}>
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
        <TextField
          label="Key MLflow"
          hint="Tên mà mã chạy ghi vào MLflow, ví dụ test/accuracy"
          value={v.key}
          onChange={(e) => set({ ...v, key: e.target.value })}
        />
        <TextField
          label="Đơn vị"
          hint="Metric không có đơn vị thì ghi thang đo, ví dụ: tỉ lệ 0–1"
          value={v.unit}
          onChange={(e) => set({ ...v, unit: e.target.value })}
        />
        <Select
          label="Hướng tốt"
          value={v.goal ?? ''}
          onChange={(e) => set({ ...v, goal: (e.target.value || null) as DraftMetric['goal'] })}
        >
          <option value="">Chưa chọn</option>
          {['maximize', 'minimize', 'target'].map((x) => (
            <option key={x} value={x}>
              {word(x)}
            </option>
          ))}
        </Select>
        <Select
          label="Cách gộp một lần chạy"
          value={v.aggregation ?? ''}
          onChange={(e) => set({ ...v, aggregation: (e.target.value || null) as DraftMetric['aggregation'] })}
        >
          <option value="">Chưa chọn</option>
          {['last', 'max', 'min', 'mean'].map((x) => (
            <option key={x} value={x}>
              {word(x)}
            </option>
          ))}
        </Select>
        <TextField
          label="Quy trình đo"
          multiline
          value={v.protocol}
          onChange={(e) => set({ ...v, protocol: e.target.value })}
        />
        {bank &&
          procedures.map((p) => (
            <div key={p.id} className={styles.row}>
              <h3 className={styles.title}>Gợi ý từ bank: {p.name}</h3>
              {p.status === 'draft' && <Badge>Bản nháp của bank</Badge>}
              <p className={styles.quiet}>{p.purpose}</p>
              {p.procedure.length > 0 && (
                <ul className={styles.steps}>
                  {p.procedure.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
              <OptionCard
                checked={v.protocolBank?.id === p.id}
                onChange={(checked) =>
                  set({ ...v, protocolBank: checked ? { id: p.id, release: bank.release } : null })
                }
                title="Theo quy trình này"
              />
            </div>
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
