import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { compareAnalyses } from '@/core/report';
import type { Analysis, Revision } from '@/core/schemas';
import { sliceCp } from '@/core/text';
import { useRepositories } from '@/shared/storage/StorageProvider';
import styles from './report.module.css';
import { labels, statuses } from '@/modules/evaluate';
import { checkLabels } from '@/modules/revise';
import { Loading } from '@/shared/ui/StateNote';
import { PageHeader } from '@/shared/ui/PageHeader';

const arrow = (value: number | null) =>
  value === null ? '—' : `${value > 0 ? '↑' : value < 0 ? '↓' : '→'} ${Math.abs(value).toFixed(2)}`;
const percent = (value: number) => `${Math.round(value * 100)} %`;
export default function ComparePage() {
  const [params] = useSearchParams();
  const a = params.get('a') ?? '';
  const b = params.get('b') ?? '';
  const repo = useRepositories();
  const [pair, setPair] = useState<[Analysis, Analysis] | null>(null);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.all([repo.analyses.get(a), repo.analyses.get(b)])
      .then(async ([left, right]) => {
        if (!left || !right) throw new Error('Analysis not found');
        const revised = [left, right].find(
          (item) =>
            item.origin?.kind === 'revision' &&
            item.parentAnalysisId === (item.id === left.id ? right.id : left.id),
        );
        const stored =
          revised?.origin?.kind === 'revision' ? await repo.revisions.get(revised.origin.revisionId) : null;
        if (active) {
          setRevision(stored ?? null);
          setPair([left, right]);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [a, b, repo]);
  if (error)
    return (
      <div role="alert">
        Không thể tải bản so sánh.
        <details>
          <summary>Chi tiết kỹ thuật</summary>
          {error}
        </details>
      </div>
    );
  if (!pair) return <Loading label="Đang tải bản so sánh…" />;
  const [left, right] = pair;
  const comparison = compareAnalyses(left, right, revision);
  const diff = (side: 'before' | 'after') =>
    comparison.diff.map((hunk, index) => {
      const span = hunk[side];
      if (!span) return null;
      const text = sliceCp(
        side === 'before' ? left.text.sourceText : right.text.sourceText,
        span.start,
        span.end,
      );
      return hunk.kind === 'equal' ? (
        text
      ) : (
        <span key={index} className={side === 'before' ? styles.deleted : styles.inserted}>
          {text}
        </span>
      );
    });
  const scoreContext = (analysis: Analysis) =>
    analysis.scores
      ? `Rubric ${analysis.scores.rubricVersion}; độ bao phủ ${percent(analysis.scores.coverage.value)}; độ tin cậy ${analysis.scores.confidence === null ? '—' : percent(analysis.scores.confidence)}; ${analysis.scores.contextLimited ? 'thiếu ngữ cảnh' : 'có ngữ cảnh'}`
      : 'Chưa chấm điểm';
  return (
    <article className={styles.report}>
      <PageHeader
        title="So sánh phiên bản"
        lead="Đối chiếu thay đổi nội dung, chỉ số và các kiểm tra giữa hai phiên bản."
      />
      <div className={styles.diff}>
        <section>
          <h2>Bản gốc</h2>
          <p className={styles.reading}>{diff('before')}</p>
          <p>Gạch ngang: phần bỏ hoặc thay thế.</p>
        </section>
        <section>
          <h2>Bản so sánh</h2>
          <p className={styles.reading}>{diff('after')}</p>
          <p>Gạch dưới: phần thêm hoặc thay thế.</p>
        </section>
      </div>
      <section>
        <h2>Thay đổi số liệu</h2>
        <div className={styles.tableScroll} role="region" aria-label="Thay đổi số liệu" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Số liệu</th>
                <th>Trước (tử/mẫu)</th>
                <th>Sau (tử/mẫu)</th>
                <th>Thay đổi</th>
              </tr>
            </thead>
            <tbody>
              {comparison.metricDeltas.map((metric) => (
                <tr key={metric.name}>
                  <th>{metric.name}</th>
                  <td>
                    {metric.before
                      ? `${metric.before.value ?? '—'} (${metric.before.numerator}/${metric.before.denominator})`
                      : '—'}
                  </td>
                  <td>
                    {metric.after
                      ? `${metric.after.value ?? '—'} (${metric.after.numerator}/${metric.after.denominator})`
                      : '—'}
                  </td>
                  <td>{arrow(metric.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {comparison.metricDeltas.length === 0 && <p>Không có số liệu để so sánh.</p>}
      </section>
      <section>
        <h2>Thay đổi điểm</h2>
        <p>Trước: {scoreContext(left)}</p>
        <p>Sau: {scoreContext(right)}</p>
        <div className={styles.tableScroll} role="region" aria-label="Thay đổi điểm" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Tiêu chí</th>
                <th>Trước</th>
                <th>Sau</th>
                <th>Thay đổi</th>
              </tr>
            </thead>
            <tbody>
              {comparison.scoreDeltas.map((score) => (
                <tr key={score.id}>
                  <th>{score.id}</th>
                  <td>{score.before}</td>
                  <td>{score.after}</td>
                  <td>{arrow(score.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {comparison.scoreDeltas.length === 0 && <p>Không có tiêu chí cùng đủ căn cứ.</p>}
      </section>
      <section>
        <h2>Vấn đề</h2>
        {!comparison.issues ? (
          <p>
            Chưa so sánh được — cần đánh giá bản sửa trước.{' '}
            {[left, right]
              .filter((item) => !item.versions.detectors)
              .map((item) => (
                <Link key={item.id} to={`/evaluate?id=${item.id}`}>
                  Mở bản {item.id === right.id ? 'so sánh' : 'gốc'} trong Đánh giá{' '}
                </Link>
              ))}
          </p>
        ) : (
          (['resolved', 'persisting', 'new'] as const).map((key) => (
            <div key={key}>
              <h3>{key === 'resolved' ? 'Đã giải quyết' : key === 'persisting' ? 'Còn lại' : 'Mới'}</h3>
              <ul>
                {comparison.issues?.[key].map((issue) => (
                  <li key={issue.id}>
                    <span title={issue.type}>{labels[issue.type]}</span> ·{' '}
                    <span title={issue.status}>{statuses[issue.status]}</span> ·{' '}
                    {issue.spans
                      .map(
                        (span) =>
                          `“${sliceCp(key === 'new' ? right.text.sourceText : left.text.sourceText, span.start, span.end)}”`,
                      )
                      .join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
      <section>
        <h2>Kiểm tra ý nghĩa</h2>
        <p>
          {comparison.checksSource === 'stored_revision'
            ? 'Kiểm tra đã lưu khi tạo bản sửa (theo chiều bản gốc → bản sửa, gồm thuật ngữ cần giữ).'
            : 'Kiểm tra tính lại cho hai văn bản (không có danh sách thuật ngữ cần giữ).'}
        </p>
        <ul>
          {comparison.checks.map((check) => (
            <li key={check.id}>
              <span title={check.id}>{checkLabels[check.id] ?? 'Kiểm tra ý nghĩa'}</span>:{' '}
              <span title={check.status}>
                {check.status === 'pass' ? (
                  <CheckCircle2 aria-hidden="true" size={16} />
                ) : check.status === 'warn' ? (
                  <AlertTriangle aria-hidden="true" size={16} />
                ) : (
                  <XCircle aria-hidden="true" size={16} />
                )}{' '}
                {check.status === 'pass' ? 'Đạt' : check.status === 'warn' ? 'Cảnh báo' : 'Không đạt'}
              </span>{' '}
              · {check.detail}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
