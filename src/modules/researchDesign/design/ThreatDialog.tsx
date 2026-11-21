import { useState } from 'react';
import type { DraftThreat } from '@/core/researchDesign/draft/schema';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { TextField } from '@/shared/ui/TextField';

export function ThreatDialog({
  threat,
  close,
  save,
}: {
  threat: DraftThreat | null;
  close: () => void;
  save: (name: string, mitigation: string) => void;
}) {
  const [name, setName] = useState(threat?.name ?? '');
  const [mitigation, setMitigation] = useState(threat?.mitigation ?? '');
  return (
    <Dialog
      title={threat ? 'Sửa threat to validity' : 'Thêm threat to validity'}
      description="Ghi threat to validity và cách giảm trong nghiên cứu này."
      onClose={close}
    >
      <div>
        <TextField label="Tên threat to validity" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          multiline
          label="Cách giảm trong nghiên cứu này"
          value={mitigation}
          onChange={(e) => setMitigation(e.target.value)}
        />
        <div>
          <Button onClick={close}>Hủy</Button>
          <Button disabled={!name.trim()} onClick={() => save(name, mitigation)}>
            Lưu
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
