import type { GenerationInput } from '@/core/prompts/generation';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Chip } from '@/shared/ui/Chip';
import { Select } from '@/shared/ui/Select';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { TextField } from '@/shared/ui/TextField';
import { useState } from 'react';
import styles from './page.module.css';

export function GenerationForm({
  input,
  onChange,
  attempted,
  highlighted,
}: {
  input: GenerationInput;
  onChange: (value: GenerationInput) => void;
  attempted: boolean;
  highlighted: string | null;
}) {
  const [term, setTerm] = useState('');
  const update = (patch: Partial<GenerationInput>) => onChange({ ...input, ...patch });
  const evidence = input.evidence;
  function move(index: number, direction: number) {
    const next = [...evidence];
    const other = index + direction;
    const a = next[index],
      b = next[other];
    if (a && b) {
      next[index] = b;
      next[other] = a;
      update({ evidence: next });
    }
  }
  return (
    <Card>
      <h2>Luận điểm và bằng chứng</h2>
      <TextField
        multiline
        label="Luận điểm chính"
        value={input.mainClaim}
        onChange={(e) => update({ mainClaim: e.target.value })}
        error={attempted && !input.mainClaim.trim() ? 'Hãy nhập luận điểm.' : undefined}
      />
      <h3>Bằng chứng</h3>
      {evidence.map((item, index) => (
        <div
          key={item.id}
          className={`${styles.evidence} ${highlighted === item.id ? styles.highlighted : ''}`}
        >
          <strong>{item.id}</strong>
          <TextField
            multiline
            label={`Nội dung ${item.id}`}
            value={item.text}
            onChange={(e) =>
              update({
                evidence: evidence.map((row) =>
                  row.id === item.id ? { ...row, text: e.target.value } : row,
                ),
              })
            }
            error={attempted && !item.text.trim() ? 'Hãy nhập bằng chứng.' : undefined}
          />
          <TextField
            label={`Trích dẫn ${item.id} (không bắt buộc)`}
            value={item.citation ?? ''}
            onChange={(e) =>
              update({
                evidence: evidence.map((row) =>
                  row.id === item.id ? { ...row, citation: e.target.value || null } : row,
                ),
              })
            }
          />
          <div className={styles.actions}>
            <Button size="sm" disabled={index === 0} onClick={() => move(index, -1)}>
              Lên {item.id}
            </Button>
            <Button size="sm" disabled={index === evidence.length - 1} onClick={() => move(index, 1)}>
              Xuống {item.id}
            </Button>
            <Button
              size="sm"
              disabled={evidence.length === 1}
              onClick={() => update({ evidence: evidence.filter((row) => row.id !== item.id) })}
            >
              Xoá {item.id}
            </Button>
          </div>
        </div>
      ))}
      <Button
        disabled={evidence.length >= 12}
        onClick={() => {
          let n = 1;
          while (evidence.some((row) => row.id === `e${n}`)) n++;
          update({ evidence: [...evidence, { id: `e${n}`, text: '', citation: null }] });
        }}
      >
        Thêm bằng chứng
      </Button>
      <Select
        label="Đối tượng đọc"
        value={input.audience}
        onChange={(e) => update({ audience: e.target.value as GenerationInput['audience'] })}
      >
        <option value="specialist">Chuyên gia</option>
        <option value="general">Đại chúng</option>
        <option value="student">Sinh viên</option>
      </Select>
      <p>Cấu trúc đoạn</p>
      <SegmentedControl
        label="Cấu trúc đoạn"
        value={input.structure}
        options={[
          { value: 'auto', label: 'Tự chọn' },
          ...['TS-D', 'LD', 'LDR', 'OCAR'].map((value) => ({ value, label: value })),
        ]}
        onChange={(value) => update({ structure: value as GenerationInput['structure'] })}
      />
      <Select
        label="Mức độ dè dặt"
        value={input.hedging}
        onChange={(e) => update({ hedging: e.target.value as GenerationInput['hedging'] })}
      >
        <option value="keep_as_given">Giữ như đã cung cấp</option>
        <option value="cautious">Thận trọng</option>
      </Select>
      <TextField label="Thuật ngữ cần giữ" value={term} onChange={(e) => setTerm(e.target.value)} />
      <Button
        onClick={() => {
          const value = term.trim();
          if (value && !input.preserveTerms.includes(value))
            update({ preserveTerms: [...input.preserveTerms, value] });
          setTerm('');
        }}
      >
        Thêm thuật ngữ
      </Button>
      <div>
        {input.preserveTerms.map((value) => (
          <Chip
            key={value}
            aria-label={`Bỏ ${value}`}
            onClick={() => update({ preserveTerms: input.preserveTerms.filter((item) => item !== value) })}
          >
            {value} ×
          </Chip>
        ))}
      </div>
    </Card>
  );
}
