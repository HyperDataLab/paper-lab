import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { AnalysisReport } from '@/core/schemas';
import { sliceCp } from '@/core/text';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { loadReport } from '@/shared/report/loadReport';
import { ReportText } from './ReportText';
import styles from './report.module.css';
import { Transparency } from '@/shared/report/Transparency';
import { labels, statuses } from '@/modules/evaluate';
import { Loading } from '@/shared/ui/StateNote';

const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)} %`);
const SEVERITIES = {
  info: 'Thông tin',
  minor: 'Nhỏ',
  moderate: 'Vừa',
  major: 'Lớn',
  critical: 'Nghiêm trọng',
};
export default function ReportPage() {
  const { id = '' } = useParams();
  const repo = useRepositories();
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void loadReport(repo, id)
      .then((value) => {
        if (active) setReport(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [id, repo]);
  if (error)
    return (
      <div role="alert">
        Không thể tải báo cáo.
        <details>
          <summary>Chi tiết kỹ thuật</summary>
          {error}
        </details>
      </div>
    );
  if (!report) return <Loading label="Đang tải báo cáo…" />;
  const { analysis } = report;
  const issues = Object.values(report.issues).flat();
  const quote = (span: { start: number; end: number } | null | undefined) =>
    span ? sliceCp(analysis.text.sourceText, span.start, span.end) : '—';
  return (
    <article className={styles.report}>
      <div className={styles.toolbar}>
        <Button onClick={() => window.print()}>In / Lưu PDF</Button>
      </div>
      <h1>Báo cáo phân tích</h1>
      <Transparency report={report} />
      <section>
        <h2>Văn bản gốc</h2>
        <ReportText report={report} />
      </section>
      <section>
        <h2>Câu</h2>
        <ol>
          {analysis.text.sentences.map((sentence) => {
            const annotation = analysis.sentenceAnnotations.find((item) => item.sentenceId === sentence.id);
            return (
              <li key={sentence.id}>
                <p>{quote(sentence)}</p>
                <p>
                  Topic: {quote(annotation?.topicSpan)} · Action: {quote(annotation?.actionSpan)} · Stress:{' '}
                  {quote(annotation?.stressSpan)} · Vai trò: {annotation?.role ?? '—'}
                </p>
              </li>
            );
          })}
        </ol>
      </section>
      <section>
        <h2>Cấu trúc paragraph &amp; mạch</h2>
        <p>
          Cấu trúc: {analysis.paragraph?.type ?? 'Chưa đánh giá'} · Độ tin cậy:{' '}
          {analysis.paragraph?.confidence ?? '—'}
        </p>
        <p>{analysis.paragraph?.rationale}</p>
        <ul>
          {analysis.flowLinks.map((link, i) => (
            <li key={i}>
              {link.fromSentenceId} → {link.toSentenceId}: {link.continuity} · {link.rationale}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Số liệu</h2>
        {analysis.paragraphMetrics ? (
          <pre>{JSON.stringify(analysis.paragraphMetrics, null, 2)}</pre>
        ) : (
          <p>Chưa có số liệu đoạn.</p>
        )}
      </section>
      <section>
        <h2>Điểm</h2>
        {analysis.scores ? (
          <>
            <p>
              Rubric: {analysis.scores.rubricVersion} · Độ bao phủ: {analysis.scores.coverage.applicable}/
              {analysis.scores.coverage.total} ({percent(analysis.scores.coverage.value)}) · Độ tin cậy:{' '}
              {percent(analysis.scores.confidence)} ·{' '}
              {analysis.scores.contextLimited ? 'Thiếu ngữ cảnh' : 'Có ngữ cảnh'}
            </p>
            <p>
              Tổng: {analysis.scores.overall ?? 'Không đủ căn cứ'} {analysis.scores.overallSuppressedReason}
            </p>
            <ul>
              {analysis.scores.dimensions.map((score) => (
                <li key={score.id}>
                  {score.label}: {score.score ?? 'Không đánh giá được'} · rubric {score.rubric ?? '—'}/4 · độ
                  tin cậy {percent(score.confidence)} · {score.descriptor ?? score.notAssessableReason}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>Chưa chấm điểm.</p>
        )}
      </section>
      <section>
        <h2>Vấn đề</h2>
        <ol>
          {issues.map((issue) => (
            <li key={issue.id}>
              <strong>{labels[issue.type]}</strong> · {statuses[issue.status]} · {SEVERITIES[issue.severity]}
              <p>{issue.spans.map((span) => `“${span.quote}”`).join('; ')}</p>
              <p>
                {issue.why} · {issue.sourcePrinciple}
              </p>
              {issue.decisions.map((event) => (
                <p key={event.id}>
                  Quyết định: {event.action} · {event.at} · {event.note}
                </p>
              ))}
            </li>
          ))}
        </ol>
        {issues.length === 0 && <p>Không có vấn đề được ghi nhận.</p>}
      </section>
      <section>
        <h2>Bản sửa / nguồn soạn</h2>
        <p>
          Nguồn: {analysis.origin?.kind ?? 'Văn bản nhập'} · Bản gốc: {report.parent?.id ?? '—'}
        </p>
        {report.revisions.map((revision) => (
          <p key={revision.id}>
            Bản sửa {revision.id} · {revision.model} · {revision.promptVersion}
          </p>
        ))}
        {report.generation && (
          <p>
            Nguồn soạn {report.generation.id} · {report.generation.model} · {report.generation.promptVersion}{' '}
            · {report.generation.input.mainClaim}
          </p>
        )}
      </section>
      <section>
        <h2>Giới hạn</h2>
        <ul>
          {report.limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Thông tin &amp; phiên bản</h2>
        <p>
          Mã: {analysis.id} · {new Date(analysis.createdAt).toLocaleString('vi-VN')} ·{' '}
          {analysis.contextLimited ? 'Thiếu ngữ cảnh' : 'Có ngữ cảnh'}
        </p>
        <p>
          Hash: {analysis.text.sourceHash} · Đơn vị: {analysis.text.offsetUnit}
        </p>
        <p>
          Tokenizer: {analysis.text.tokenizerVersion} · Segmenter: {analysis.text.segmenterVersion}
        </p>
        <ul>
          {Object.entries(analysis.versions)
            .filter(([key]) => key !== 'paperStepKeys')
            .map(([key, value]) => (
              <li key={key}>
                {key}: {typeof value === 'string' ? value : '—'}
              </li>
            ))}
        </ul>
      </section>
    </article>
  );
}
