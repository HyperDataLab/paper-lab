import type { Issue } from '@/core/schemas';
import type { Scores } from '@/core/schemas/scores';
import { issueSnapshot } from '@/core/scoring/computeScores';
import { AlertTriangle, ChevronRight, Gauge, Info, RefreshCw } from 'lucide-react';
import { Card } from '@/shared/ui/Card';
import { Empty } from '@/shared/ui/StateNote';
import { Chip } from '@/shared/ui/Chip';
import { labels } from './issueLabels';
import styles from './scores.module.css';

const number = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
export function ScoresView({
  scores,
  issues,
  onIssue,
  onSentence,
  styleWarning = null,
  readOnly = false,
}: {
  scores: Scores | null;
  issues: Issue[];
  onIssue: (id: string) => void;
  onSentence: (id: string) => void;
  styleWarning?: string | null;
  readOnly?: boolean;
}) {
  const issueName = (id: string) => {
    const issue = issues.find((item) => item.id === id);
    return issue ? labels[issue.type] : 'Gợi ý';
  };
  const caveat =
    'Điểm đo chất lượng diễn đạt theo rubric thử nghiệm, chưa hiệu chuẩn; không đánh giá tính đúng khoa học.';
  if (!scores)
    return (
      <Empty
        icon={<Gauge size={20} />}
        title={readOnly ? 'Bản phân tích đã lưu này chưa được chấm điểm' : 'Chưa có điểm'}
        hint={readOnly ? caveat : `Chọn Chấm điểm (AI) ở bước 4 để đánh giá. ${caveat}`}
      />
    );
  const overall = scores.overall;
  return (
    <div className={styles.view}>
      <section className={styles.overview} aria-label="Tổng quan điểm">
        <div className={styles.total}>
          <span className={styles.label}>Điểm tổng</span>
          <p className={styles.totalValue}>
            <strong>{overall === null ? 'Chưa tính' : number(overall)}</strong>
            {overall !== null && <span>/ 100</span>}
          </p>
          {overall !== null && (
            <span className={styles.bar} aria-hidden="true">
              <span style={{ width: `${overall}%` }} />
            </span>
          )}
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>Tiêu chí đánh giá được</dt>
            <dd>{`${scores.coverage.applicable}/${scores.coverage.total}`}</dd>
          </div>
          <div>
            <dt>Độ tin cậy</dt>
            <dd>{scores.confidence === null ? '—' : `${number(scores.confidence * 100)} %`}</dd>
          </div>
          <div>
            <dt>Rubric</dt>
            <dd>{scores.rubricVersion}</dd>
          </div>
          <div>
            <dt>Ngữ cảnh</dt>
            <dd>{scores.contextLimited ? 'Chỉ xét riêng đoạn này' : 'Đủ ngữ cảnh'}</dd>
          </div>
        </dl>
      </section>
      {(scores.overallSuppressedReason || styleWarning || scores.issueSnapshot !== issueSnapshot(issues)) && (
        <div className={styles.notices}>
          {scores.overallSuppressedReason && (
            <p className={styles.notice}>
              <Info size={16} aria-hidden="true" />
              {scores.overallSuppressedReason}
            </p>
          )}
          {styleWarning && (
            <p role="status" className={styles.notice}>
              <AlertTriangle size={16} aria-hidden="true" />
              Điểm trên bài này có thể bị ảnh hưởng bởi văn phong (kiểm tra độ bền ngày{' '}
              {new Date(styleWarning).toLocaleDateString('vi-VN')}).
            </p>
          )}
          {scores.issueSnapshot !== issueSnapshot(issues) && (
            <p role="status" className={styles.notice}>
              <RefreshCw size={16} aria-hidden="true" />
              Điểm có thể đã cũ do bạn vừa xác nhận/bỏ qua gợi ý — chấm lại để cập nhật
            </p>
          )}
        </div>
      )}
      <Card>
        <h2 className={styles.title}>Điểm theo tiêu chí</h2>
        <div className={styles.table}>
          <div className={styles.headRow} aria-hidden="true">
            <span />
            <span>Tiêu chí</span>
            <span>Trọng số</span>
            <span>Điểm</span>
            <span>Mức</span>
            <span>Tin cậy</span>
          </div>
          {scores.dimensions.map((dimension) => (
            <details key={dimension.id} className={styles.dimension}>
              <summary className={styles.dimRow}>
                <ChevronRight size={16} className={styles.chevron} aria-hidden="true" />
                <span className={styles.dimName}>{dimension.label}</span>
                <span className={styles.weight}>{number(dimension.weight * 100)} %</span>
                {dimension.applicable ? (
                  <>
                    <span className={styles.dimScore}>
                      <span className={styles.bar} aria-hidden="true">
                        <span style={{ width: `${dimension.score ?? 0}%` }} />
                      </span>
                      <span>{number(dimension.score ?? 0)}</span>
                      {dimension.score !== null && (
                        <progress
                          className={styles.srOnly}
                          max={100}
                          value={dimension.score}
                          aria-label={dimension.label}
                        />
                      )}
                    </span>
                    <span className={styles.level}>
                      Mức {dimension.rubric}/4 · {dimension.descriptor}
                    </span>
                    <span className={styles.weight}>
                      {dimension.confidence === null
                        ? '—'
                        : `Tin cậy ${number(dimension.confidence * 100)} %`}
                    </span>
                  </>
                ) : (
                  <span className={styles.notAssessable}>
                    Chưa đánh giá được: {dimension.notAssessableReason}
                    {!readOnly && (
                      <span>
                        {' '}
                        ·{' '}
                        {dimension.notAssessableReason === 'AI không đủ căn cứ'
                          ? 'Bổ sung ngữ cảnh và chấm lại'
                          : dimension.id === 'sentence_structure'
                            ? 'Chạy Phân tích câu'
                            : 'Chạy Phân tích cấu trúc paragraph'}
                      </span>
                    )}
                  </span>
                )}
              </summary>
              <div className={styles.dimBody}>
                {dimension.rationale ? <p>{dimension.rationale}</p> : <p>AI không ghi lý do.</p>}
                {(dimension.evidence.issueIds.length > 0 || dimension.evidence.sentenceIds.length > 0) && (
                  <div className={styles.evidence}>
                    <span>Dẫn chứng</span>
                    {dimension.evidence.issueIds.map((id) => (
                      <Chip key={id} data-issue={id} onClick={() => onIssue(id)}>
                        {issueName(id)}
                      </Chip>
                    ))}
                    {dimension.evidence.sentenceIds.map((id) => (
                      <Chip key={id} onClick={() => onSentence(id)}>
                        {id}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
        <p className={styles.caveat}>{caveat}</p>
      </Card>
    </div>
  );
}
