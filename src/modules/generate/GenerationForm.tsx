import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { IconButton } from '@/shared/ui/IconButton';
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

const AUDIENCE: Record<GenerationInput['audience'], string> = {
  specialist: 'Chuyên gia',
  general: 'Đại chúng',
  student: 'Sinh viên',
};

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
      <h2 className={styles.formTitle}>Thiết lập soạn đoạn</h2>
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
              <div className={styles.stack}>
                <TextField
                  multiline
                  rows={3}
                  label="Luận điểm chính"
                  hint="Một câu nói điều đoạn văn cần chứng minh."
                  placeholder="Ví dụ: Drought reduces carbon use efficiency in grassland soils."
                  value={input.mainClaim}
                  onChange={(e) => update({ mainClaim: e.target.value })}
                  error={attempted && !input.mainClaim.trim() ? 'Hãy nhập luận điểm.' : undefined}
                />
                <div className={styles.sectionHead}>
                  <h3>Bằng chứng</h3>
                  <span>{evidence.length}/12 · AI chỉ dùng những gì bạn đưa vào đây</span>
                </div>
                <ol className={styles.evidenceList}>
                  {evidence.map((item, index) => (
                    <li key={item.id}>
                      <div
                        className={`${styles.evidence} ${highlighted === item.id ? styles.highlighted : ''}`}
                      >
                        <div className={styles.itemHead}>
                          <strong className={styles.tag}>{item.id}</strong>
                          <span>Bằng chứng {index + 1}</span>
                          <div className={styles.itemActions}>
                            <IconButton
                              size="sm"
                              label={`Lên ${item.id}`}
                              disabled={index === 0}
                              onClick={() => move(index, -1)}
                            >
                              <ArrowUp size={16} />
                            </IconButton>
                            <IconButton
                              size="sm"
                              label={`Xuống ${item.id}`}
                              disabled={index === evidence.length - 1}
                              onClick={() => move(index, 1)}
                            >
                              <ArrowDown size={16} />
                            </IconButton>
                            <IconButton
                              size="sm"
                              tone="danger"
                              label={`Xoá ${item.id}`}
                              disabled={evidence.length === 1}
                              onClick={() =>
                                update({ evidence: evidence.filter((row) => row.id !== item.id) })
                              }
                            >
                              <Trash2 size={16} />
                            </IconButton>
                          </div>
                        </div>
                        <TextField
                          multiline
                          rows={2}
                          label={`Nội dung ${item.id}`}
                          placeholder="Kết quả, số liệu hoặc phát hiện, kèm đơn vị nếu có."
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
                          size="sm"
                          label={`Trích dẫn ${item.id} (không bắt buộc)`}
                          placeholder="Ví dụ: Smith et al., 2010"
                          value={item.citation ?? ''}
                          onChange={(e) =>
                            update({
                              evidence: evidence.map((row) =>
                                row.id === item.id ? { ...row, citation: e.target.value || null } : row,
                              ),
                            })
                          }
                        />
                      </div>
                    </li>
                  ))}
                </ol>
                <Button
                  className={styles.addEvidence}
                  disabled={evidence.length >= 12}
                  onClick={() => {
                    let n = 1;
                    while (evidence.some((row) => row.id === `e${n}`)) n++;
                    update({ evidence: [...evidence, { id: `e${n}`, text: '', citation: null }] });
                  }}
                >
                  <Plus size={16} aria-hidden="true" />
                  Thêm bằng chứng
                </Button>
              </div>
            ),
          },
          {
            id: 'style',
            title: 'Cách viết',
            content: (
              <div className={styles.stack}>
                <div className={styles.twoUp}>
                  <Select
                    label="Đối tượng đọc"
                    value={input.audience}
                    onChange={(e) => update({ audience: e.target.value as GenerationInput['audience'] })}
                  >
                    <option value="specialist">Chuyên gia</option>
                    <option value="general">Đại chúng</option>
                    <option value="student">Sinh viên</option>
                  </Select>
                  <Select
                    label="Mức độ dè dặt"
                    value={input.hedging}
                    onChange={(e) => update({ hedging: e.target.value as GenerationInput['hedging'] })}
                  >
                    <option value="keep_as_given">Giữ như đã cung cấp</option>
                    <option value="cautious">Thận trọng</option>
                  </Select>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Cấu trúc đoạn</span>
                  <SegmentedControl
                    label="Cấu trúc đoạn"
                    value={input.structure}
                    options={[
                      { value: 'auto', label: 'Tự chọn' },
                      ...['TS-D', 'LD', 'LDR', 'OCAR'].map((value) => ({ value, label: value })),
                    ]}
                    onChange={(value) => update({ structure: value as GenerationInput['structure'] })}
                  />
                  <span className={styles.fieldHint}>
                    TS-D: câu chủ đề rồi phát triển · LD: dẫn dắt rồi phát triển · LDR: thêm câu kết · OCAR:
                    mở, thách thức, hành động, kết quả.
                  </span>
                </div>
                <div className={styles.field}>
                  <form
                    className={styles.termRow}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const value = term.trim();
                      if (value && !input.preserveTerms.includes(value))
                        update({ preserveTerms: [...input.preserveTerms, value] });
                      setTerm('');
                    }}
                  >
                    <TextField
                      label="Thuật ngữ cần giữ"
                      hint="AI giữ nguyên các từ này, không thay bằng từ đồng nghĩa."
                      value={term}
                      onChange={(e) => setTerm(e.target.value)}
                    />
                    <Button type="submit">
                      <Plus size={16} aria-hidden="true" />
                      Thêm thuật ngữ
                    </Button>
                  </form>
                  {input.preserveTerms.length > 0 && (
                    <div className={styles.terms}>
                      {input.preserveTerms.map((value) => (
                        <Chip
                          key={value}
                          aria-label={`Bỏ ${value}`}
                          onClick={() =>
                            update({ preserveTerms: input.preserveTerms.filter((item) => item !== value) })
                          }
                        >
                          {value} <X size={12} aria-hidden="true" />
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ),
          },
          {
            id: 'confirm',
            title: 'Xác nhận và chạy',
            content: (
              <div className={styles.stack}>
                <div className={styles.review}>
                  <h3>Luận điểm</h3>
                  <p className={styles.claim}>{input.mainClaim}</p>
                </div>
                <dl className={styles.settings}>
                  <div>
                    <dt>Đối tượng đọc</dt>
                    <dd>{AUDIENCE[input.audience]}</dd>
                  </div>
                  <div>
                    <dt>Cấu trúc</dt>
                    <dd>{input.structure === 'auto' ? 'Tự chọn' : input.structure}</dd>
                  </div>
                  <div>
                    <dt>Dè dặt</dt>
                    <dd>{input.hedging === 'cautious' ? 'Thận trọng' : 'Giữ như đã cung cấp'}</dd>
                  </div>
                  <div>
                    <dt>Thuật ngữ giữ</dt>
                    <dd>{input.preserveTerms.join(', ') || '—'}</dd>
                  </div>
                </dl>
                <div className={styles.review}>
                  <h3>Bằng chứng ({evidence.length})</h3>
                  <ol className={styles.evidenceList}>
                    {evidence.map((item) => (
                      <li key={item.id}>
                        <div
                          className={`${styles.evidence} ${styles.evidenceRead} ${highlighted === item.id ? styles.highlighted : ''}`}
                        >
                          <strong className={styles.tag}>{item.id}</strong>
                          <div>
                            <p>{item.text}</p>
                            {item.citation && <small>{item.citation}</small>}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}
