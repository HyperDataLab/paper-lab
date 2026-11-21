import { useState } from 'react';
import { currentArtifact } from '@/core/autoresearch/artifacts';
import { STAGES, type Stage } from '@/core/autoresearch/contracts';
import type { Run } from '@/core/autoresearch/record';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { obligationStatus, stageLabels } from './labels';
import styles from './autoresearch.module.css';

export function ObligationsPanel({
  run,
  stage,
  busy,
  change,
}: {
  run: Run;
  stage: Stage;
  busy: boolean;
  change: (id: string, status: 'controlled' | 'unresolved', note: string) => Promise<boolean>;
}) {
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  if (!run.obligations.length) return null;
  const active = run.status === 'waiting' && !busy;
  const artifact = currentArtifact(run, stage);
  const eligible = run.obligations.filter(
    (item) => STAGES.indexOf(stage) >= STAGES.indexOf(item.targetStage) && item.status !== 'controlled',
  );
  return (
    <section aria-labelledby="ar-obligations">
      <h3 id="ar-obligations">Nghĩa vụ theo dõi</h3>
      <ul className={styles.rows}>
        {run.obligations.map((item) => (
          <li key={item.id}>
            <Badge tone={item.status === 'controlled' ? 'success' : 'warning'}>
              {obligationStatus[item.status]}
            </Badge>
            <p>{item.text}</p>
            <small>
              {stageLabels[item.sourceStage]} → {stageLabels[item.targetStage]}
            </small>
            {item.note && <p>{item.note}</p>}
          </li>
        ))}
      </ul>
      {active && !!eligible.length && (
        <div className={styles.stack}>
          <Select label="Nghĩa vụ cần cập nhật" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Chọn nghĩa vụ</option>
            {eligible.map((item) => (
              <option key={item.id} value={item.id}>
                {item.text}
              </option>
            ))}
          </Select>
          <TextField
            label="Căn cứ xử lý nghĩa vụ"
            value={note}
            multiline
            onChange={(event) => setNote(event.target.value)}
          />
          <div className={styles.actions}>
            <Button
              disabled={!target || !note.trim()}
              onClick={() => void change(target, 'unresolved', note)}
            >
              Đánh dấu chưa xử lý
            </Button>
            <Button
              disabled={!artifact || !target || !note.trim()}
              onClick={() => void change(target, 'controlled', note)}
            >
              Ghi nhận đã xử lý
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
