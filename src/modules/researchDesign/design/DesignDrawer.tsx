import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BankDoc } from '@/core/researchDesign/bank/snapshot';
import { designFromBank } from '@/core/researchDesign/draft/ops';
import type { DraftDesign } from '@/core/researchDesign/draft/schema';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Drawer } from '@/shared/ui/Drawer';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { TextField } from '@/shared/ui/TextField';
import { assignments, word } from './words';

export function DesignDrawer({
  bank,
  onClose,
  choose,
}: {
  bank: BankDoc | null;
  onClose: () => void;
  choose: (design: DraftDesign) => void;
}) {
  const [name, setName] = useState('');
  const [assignment, setAssignment] = useState<DraftDesign['assignment']>(null);
  return (
    <Drawer open onClose={onClose} side="right" label="Chọn research design">
      <h2>Chọn research design</h2>
      {!bank && (
        <p>
          Chưa có bản chụp. <Link to={'?design=bank'}>Writing Bank</Link>
        </p>
      )}
      {bank?.collections.designs.map((d) => (
        <div key={d.id}>
          <h3>{d.name}</h3>
          {d.status === 'draft' && <Badge>Bản nháp của bank</Badge>}
          <p>
            {word('family', d.family)} · {word('causalLicence', d.causalLicence)}
          </p>
          <p>{d.definition.match(/^.*?[.!?](?:\s|$)/)?.[0].trim() ?? d.definition}</p>
          <Button onClick={() => choose(designFromBank(d, bank.release))}>Chọn</Button>
        </div>
      ))}
      <div>
        <h3>Tự mô tả research design</h3>
        <TextField label="Tên research design" value={name} onChange={(e) => setName(e.target.value)} />
        <p>Cách phân nhóm</p>
        <SegmentedControl
          label="Cách phân nhóm"
          value={assignment ?? ''}
          options={assignments}
          onChange={(v) => setAssignment(v as DraftDesign['assignment'])}
        />
        <Button disabled={!name.trim()} onClick={() => choose({ name, assignment, bank: null })}>
          Chọn research design tự mô tả
        </Button>
      </div>
    </Drawer>
  );
}
