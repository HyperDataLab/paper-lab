import { useCallback, useState } from 'react';
import { selectable } from '@/core/autoresearch/artifacts';
import type { Artifact, StageState } from '@/core/autoresearch/record';
import { Button } from '@/shared/ui/Button';
import { Drawer } from '@/shared/ui/Drawer';
import { OptionCard } from '@/shared/ui/OptionCard';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { stageLabels } from './labels';
import { ArtifactFields } from './ArtifactFields';

export type GateChoice = { approve: boolean; ids: string[]; primaryId: string | null; note: string | null };
export function GateSheet({
  state,
  artifact,
  itemLabels,
  close,
  decide,
  busy,
  error,
}: {
  state: StageState;
  artifact: Artifact | undefined;
  itemLabels?: Map<string, string>;
  close: () => void;
  decide: (choice: GateChoice) => void;
  busy: boolean;
  error?: string;
}) {
  const items = selectable(artifact);
  const [ids, setIds] = useState(() => (state.stage === 'S8' ? [] : items.map((item) => item.id)));
  const [primary, setPrimary] = useState('');
  const [note, setNote] = useState('');
  const onClose = useCallback(() => {
    if (!busy) close();
  }, [busy, close]);
  const choose = (approve: boolean) =>
    decide({ approve, ids, primaryId: primary || null, note: note.trim() || null });
  const title = `Duyệt ${stageLabels[state.stage]}`;
  return (
    <Drawer
      open
      side="right"
      size="lg"
      label={title}
      title={title}
      onClose={onClose}
      description="Chọn nội dung giữ lại hoặc ghi lý do để chạy lại."
      footer={
        <>
          <Button variant="danger" disabled={busy || !note.trim()} onClick={() => choose(false)}>
            Từ chối
          </Button>
          <Button
            variant="primary"
            disabled={
              busy ||
              !artifact ||
              !!state.error ||
              (items.length > 0 && !ids.length) ||
              (state.stage === 'S8' && !primary)
            }
            onClick={() => choose(true)}
          >
            Duyệt
          </Button>
        </>
      }
    >
      {error && (
        <div role="alert">
          <p>Không lưu được quyết định. Vui lòng thử lại.</p>
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            {error}
          </details>
        </div>
      )}
      {state.error && <p role="alert">Stage chưa đạt điều kiện để duyệt.</p>}
      {state.critic?.verdict === 'serious' && (
        <p role="alert">
          Critic có điểm nghiêm trọng. Các rủi ro được chấp nhận sẽ được ghi vào sổ theo dõi.
        </p>
      )}
      {!state.error &&
        items.map((item) => (
          <OptionCard
            key={item.id}
            title={itemLabels?.get(item.id) ?? item.label}
            description={itemLabels?.has(item.id) ? item.label : undefined}
            checked={ids.includes(item.id)}
            disabled={busy}
            onChange={(checked) => {
              setIds((previous) =>
                checked ? [...previous, item.id] : previous.filter((id) => id !== item.id),
              );
              if (!checked && primary === item.id) setPrimary('');
            }}
          />
        ))}
      {state.stage === 'S8' && (
        <Select
          label="Primary hypothesis"
          value={primary}
          disabled={busy}
          onChange={(event) => setPrimary(event.target.value)}
        >
          <option value="">Chọn primary hypothesis</option>
          {items
            .filter((item) => ids.includes(item.id))
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
        </Select>
      )}
      <TextField
        label="Ghi chú duyệt hoặc lý do từ chối"
        multiline
        value={note}
        disabled={busy}
        onChange={(event) => setNote(event.target.value)}
      />
      {artifact && !state.error && (
        <details>
          <summary>Xem kết quả</summary>
          <ArtifactFields value={artifact.content} />
        </details>
      )}
    </Drawer>
  );
}
