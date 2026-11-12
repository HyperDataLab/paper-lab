import { useState } from 'react';
import {
  MMAT_CATEGORIES,
  MMAT_JUDGEMENTS,
  MMAT_SCREENING,
  categoryOf,
  criteriaRequired,
  currentAppraisal,
  recordAppraisal,
  type AppraisalInput,
  type MmatAnswer,
  type MmatCategory,
  type MmatCriterion,
  type MmatJudgement,
} from '@/core/corpus/appraisal';
import type { Corpus, CorpusMember } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { appraisalErrors, categoryLabel, criterionLabel, judgementLabels } from './appraisalLabels';
import styles from './corpus.module.css';

const OPTIONS = MMAT_JUDGEMENTS.map((value) => ({ value, label: judgementLabels[value] }));

/** One MMAT 2018 appraisal of one included study; saving appends a new set, earlier ones stay in the log. */
export function AppraisalForm({
  corpus,
  member,
  save,
  onDone,
}: {
  corpus: Corpus;
  member: CorpusMember;
  save: (value: Corpus) => Promise<void>;
  onDone: () => void;
}) {
  const previous = currentAppraisal(member);
  const [appraiser, setAppraiser] = useState(previous?.appraiser ?? '');
  const [category, setCategory] = useState<AppraisalInput['category']>(previous?.category.id ?? '');
  const [answers, setAnswers] = useState<AppraisalInput['answers']>(previous?.answers ?? {});
  const [error, setError] = useState('');
  const criteria = (category && categoryOf(category)?.criteria) || [];
  const set = (id: string, patch: Partial<MmatAnswer>) =>
    setAnswers((current) => {
      const old = current[id];
      const judgement = patch.judgement ?? old?.judgement;
      return judgement ? { ...current, [id]: { ...old, ...patch, judgement } } : current;
    });
  function submit() {
    const result = recordAppraisal(
      corpus,
      member.memberId,
      { category, answers, appraiser },
      new Date().toISOString(),
    );
    if (!result.ok) {
      setError(appraisalErrors[result.error]);
      return;
    }
    void save(result.corpus)
      .then(onDone)
      .catch((cause: unknown) => setError(String(cause)));
  }
  const item = (criterion: MmatCriterion) => {
    const answer = answers[criterion.id];
    const label = criterionLabel(criterion);
    return (
      <div key={criterion.id} className={styles.appraisalItem}>
        <span>{label}</span>
        <SegmentedControl
          label={label}
          value={answer?.judgement ?? ''}
          options={OPTIONS}
          onChange={(value) => set(criterion.id, { judgement: value as MmatJudgement })}
        />
        {answer && (
          <div className={styles.row}>
            <TextField
              label="Trích dẫn hỗ trợ"
              hint="Không bắt buộc"
              value={answer.quote ?? ''}
              onChange={(event) => set(criterion.id, { quote: event.target.value })}
            />
            <TextField
              label="Ghi chú"
              hint="Không bắt buộc"
              value={answer.note ?? ''}
              onChange={(event) => set(criterion.id, { note: event.target.value })}
            />
          </div>
        )}
      </div>
    );
  };
  return (
    <div className={styles.form}>
      <div className={styles.row}>
        <TextField
          label="Người đánh giá"
          value={appraiser}
          onChange={(event) => setAppraiser(event.target.value)}
        />
        <Select
          label="Loại nghiên cứu"
          value={category}
          onChange={(event) => setCategory(event.target.value as MmatCategory)}
        >
          <option value="">Chọn loại nghiên cứu</option>
          {MMAT_CATEGORIES.map((option) => (
            <option key={option.id} value={option.id}>
              {categoryLabel(option.id)}
            </option>
          ))}
        </Select>
      </div>
      <h3>Câu hỏi sàng lọc</h3>
      {MMAT_SCREENING.map(item)}
      {MMAT_SCREENING.every((question) => answers[question.id]) && !criteriaRequired(answers) && (
        <p className={styles.notice}>
          Có câu sàng lọc là Không hoặc Không rõ: MMAT cho rằng có thể không nên đánh giá tiếp, nên năm tiêu
          chí không bắt buộc.
        </p>
      )}
      {criteria.length > 0 && <h3>Tiêu chí của loại nghiên cứu</h3>}
      {criteria.map(item)}
      {error && <p role="alert">{error}</p>}
      <div className={styles.cardTools}>
        <Button variant="primary" onClick={submit}>
          Lưu đánh giá
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Huỷ
        </Button>
      </div>
    </div>
  );
}
