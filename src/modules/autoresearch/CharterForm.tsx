import { useState } from 'react';
import { charterSchema, type Charter } from '@/core/autoresearch/contracts';
import { Button } from '@/shared/ui/Button';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { charterLabels } from './labels';
import styles from './autoresearch.module.css';

const fields = [
  'objectives',
  'scope_in',
  'scope_out',
  'success_criteria',
  'kill_criteria',
  'constraints',
] as const;
export function CharterForm({
  current,
  question,
  hasResults,
  cancel,
  submit,
}: {
  current: Charter | null;
  question: string;
  hasResults: boolean;
  cancel: () => void;
  submit: (charter: Charter, note: string | null) => void;
}) {
  const [values, setValues] = useState({
    question: current?.question ?? question,
    objectives: current?.objectives.join('\n') ?? '',
    scope_in: current?.scope_in.join('\n') ?? '',
    scope_out: current?.scope_out.join('\n') ?? '',
    success_criteria: current?.success_criteria.join('\n') ?? '',
    kill_criteria: current?.kill_criteria.join('\n') ?? '',
    constraints: current?.constraints.join('\n') ?? '',
  });
  const [risk, setRisk] = useState<Charter['risk_posture']>(current?.risk_posture ?? 'exploratory');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const change = (key: keyof typeof values, value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  return (
    <form
      className={styles.stack}
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = charterSchema.safeParse({
          question: values.question,
          risk_posture: risk,
          ...Object.fromEntries(
            fields.map((field) => [
              field,
              values[field]
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
            ]),
          ),
        });
        if (!parsed.success || (hasResults && !note.trim())) {
          setError(
            'Kiểm tra research question, phạm vi, từ 2 đến 4 mục tiêu, ít nhất một tiêu chí thành công và lý do sửa khi đã có kết quả.',
          );
          return;
        }
        setError('');
        submit(parsed.data, note.trim() || null);
      }}
    >
      <TextField
        label={charterLabels.question}
        required
        value={values.question}
        onChange={(e) => change('question', e.target.value)}
      />
      {fields.map((field) => (
        <TextField
          key={field}
          label={charterLabels[field]}
          multiline
          rows={2}
          value={values[field]}
          hint={field === 'objectives' ? 'Từ 2 đến 4 mục tiêu, mỗi dòng một mục.' : undefined}
          onChange={(e) => change(field, e.target.value)}
        />
      ))}
      <Select
        label={charterLabels.risk_posture}
        value={risk}
        onChange={(e) => setRisk(e.target.value === 'confirmatory' ? 'confirmatory' : 'exploratory')}
      >
        <option value="exploratory">Exploratory</option>
        <option value="confirmatory">Confirmatory</option>
      </Select>
      {hasResults && (
        <TextField
          label="Lý do sửa charter đã có kết quả"
          required
          multiline
          value={note}
          onChange={(e) => setNote(e.target.value)}
          hint="Việc sửa charter cần bạn xác nhận và sẽ đánh dấu các kết quả hiện tại là đã cũ."
        />
      )}
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        <Button type="button" variant="ghost" onClick={cancel}>
          Huỷ
        </Button>
        <Button type="submit" variant="primary">
          {hasResults ? 'Xác nhận và sửa charter' : 'Duyệt charter'}
        </Button>
      </div>
    </form>
  );
}
