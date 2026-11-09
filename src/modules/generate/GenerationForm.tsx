import type { GenerationInput } from '@/core/prompts/generation';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Chip } from '@/shared/ui/Chip';
import { Select } from '@/shared/ui/Select';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { TextField } from '@/shared/ui/TextField';
import { Wizard } from '@/shared/ui/Wizard';
import { useState } from 'react';
import styles from './page.module.css';

export function GenerationForm({
  input,
  onChange,
  attempted,
  highlighted,
  finishLabel,
  finishDisabled,
  finishVariant,
  onFinish,
  initialStep,
}: {
  input: GenerationInput;
  onChange: (value: GenerationInput) => void;
  attempted: boolean;
  highlighted: string | null;
  finishLabel: string;
  finishDisabled: boolean;
  finishVariant: 'primary' | 'secondary';
  onFinish: () => void;
  initialStep: number;
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
  const ready = Boolean(input.mainClaim.trim()) && evidence.every((item) => item.text.trim());
  return (
    <Card>
      <h2>Thiết lập soạn đoạn</h2>
      <Wizard
        label="Các bước soạn đoạn"
        initialStep={initialStep}
        finishLabel={finishLabel}
        finishDisabled={finishDisabled}
        finishVariant={finishVariant}
        onFinish={onFinish}
        note={
          ready
            ? 'Ước tính: 1 lượt gọi AI (có thể phát sinh khi thử lại hoặc sửa kết quả).'
            : 'Cần có luận điểm và nội dung cho mọi bằng chứng để tiếp tục.'
        }
        steps={[
          {
            id: 'claim',
            title: 'Luận điểm và bằng chứng',
            summary: `${evidence.length} bằng chứng`,
            ready,
            content: (
              <>
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
                      <Button
                        size="sm"
                        disabled={index === evidence.length - 1}
                        onClick={() => move(index, 1)}
                      >
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
              </>
            ),
          },
          {
            id: 'style',
            title: 'Cách viết',
            content: (
              <>
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
                      onClick={() =>
                        update({ preserveTerms: input.preserveTerms.filter((item) => item !== value) })
                      }
                    >
                      {value} ×
                    </Chip>
                  ))}
                </div>
              </>
            ),
          },
          {
            id: 'confirm',
            title: 'Xác nhận và chạy',
            content: (
              <>
                <h3>Luận điểm</h3>
                <p>{input.mainClaim}</p>
                <h3>Bằng chứng</h3>
                {evidence.map((item) => (
                  <div
                    key={item.id}
                    className={`${styles.evidence} ${highlighted === item.id ? styles.highlighted : ''}`}
                  >
                    <strong>{item.id}</strong>
                    <p>{item.text}</p>
                    {item.citation && <small>{item.citation}</small>}
                  </div>
                ))}
              </>
            ),
          },
        ]}
      />
    </Card>
  );
}
