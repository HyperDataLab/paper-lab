import type { Issue } from '@/core/schemas';
import type { Scores } from '@/core/schemas/scores';
import { issueSnapshot } from '@/core/scoring/computeScores';
import { Card } from '@/shared/ui/Card';
import { Chip } from '@/shared/ui/Chip';

const number = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
export function ScoresView({
  scores,
  issues,
  onIssue,
  onSentence,
}: {
  scores: Scores | null;
  issues: Issue[];
  onIssue: (id: string) => void;
  onSentence: (id: string) => void;
}) {
  if (!scores)
    return (
      <Card>
        <p>Chưa có điểm. Chọn Chấm điểm (AI) để đánh giá.</p>
        <p>
          Điểm đo chất lượng diễn đạt theo rubric thử nghiệm, chưa hiệu chuẩn; không đánh giá tính đúng khoa
          học.
        </p>
      </Card>
    );
  return (
    <Card>
      <h2>Điểm</h2>
      <p>
        {scores.overall === null ? 'Chưa tính điểm tổng' : `Tổng ${number(scores.overall)} / 100`} · Phủ{' '}
        {scores.coverage.applicable}/{scores.coverage.total} tiêu chí · Tin cậy{' '}
        {scores.confidence === null ? '—' : `${number(scores.confidence * 100)} %`} · Rubric{' '}
        {scores.rubricVersion} · {scores.contextLimited ? 'context_limited' : 'đủ ngữ cảnh'}
      </p>
      {scores.overallSuppressedReason && <p>{scores.overallSuppressedReason}</p>}
      {scores.issueSnapshot !== issueSnapshot(issues) && (
        <p role="status">Điểm có thể đã cũ do bạn vừa xác nhận/bỏ qua gợi ý — chấm lại để cập nhật</p>
      )}
      {scores.dimensions.map((dimension) => (
        <details key={dimension.id}>
          <summary>
            {dimension.label} · {number(dimension.weight * 100)} % ·{' '}
            {dimension.applicable
              ? `${number(dimension.score ?? 0)} / 100 · Mức ${dimension.rubric}/4 · ${dimension.descriptor} · Tin cậy ${dimension.confidence === null ? '—' : `${number(dimension.confidence * 100)} %`}`
              : `Chưa đánh giá được: ${dimension.notAssessableReason}`}
            {dimension.score !== null && (
              <progress max={100} value={dimension.score} aria-label={dimension.label} />
            )}
            {!dimension.applicable && (
              <span>
                {' '}
                ·{' '}
                {dimension.notAssessableReason === 'AI không đủ căn cứ'
                  ? 'Bổ sung ngữ cảnh và chấm lại'
                  : dimension.id === 'sentence_structure'
                    ? 'Chạy Phân tích câu'
                    : 'Chạy Phân tích cấu trúc đoạn'}
              </span>
            )}
          </summary>
          {dimension.rationale && <p>{dimension.rationale}</p>}
          {dimension.evidence.issueIds.map((id) => (
            <Chip key={id} onClick={() => onIssue(id)}>
              {id}
            </Chip>
          ))}
          {dimension.evidence.sentenceIds.map((id) => (
            <Chip key={id} onClick={() => onSentence(id)}>
              {id}
            </Chip>
          ))}
        </details>
      ))}
      <p>
        Điểm đo chất lượng diễn đạt theo rubric thử nghiệm, chưa hiệu chuẩn; không đánh giá tính đúng khoa
        học.
      </p>
    </Card>
  );
}
