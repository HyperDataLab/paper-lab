import { Link2, Network, Unlink } from 'lucide-react';
import type { TextAnalysis } from '@/core/schemas';
import type { ParagraphMetrics } from '@/core/schemas/paragraph';
import { createOffsetIndex } from '@/core/text';
import { Badge } from '@/shared/ui/Badge';
import { Card } from '@/shared/ui/Card';
import { Empty } from '@/shared/ui/StateNote';
import styles from './paragraph.module.css';
import {
  continuityLabels,
  identifiabilityLabels,
  metricLabels,
  relationLabels,
  roleLabels,
} from './roleLabels';
import type { useParagraphAnalysis } from './useParagraphAnalysis';

type Fraction = ParagraphMetrics['sentence_role_coverage'];
const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)} %`);

function formatMetric(key: keyof typeof metricLabels, metric: Fraction): string {
  const { unit, percent } = metricLabels[key];
  if (key === 'central_point_identifiability')
    return `${metric.numerator}/4 (${identifiabilityLabels[metric.numerator] ?? '—'})`;
  const base = `${metric.numerator}/${metric.denominator}${unit ? ` ${unit}` : ''}`;
  return percent ? `${base} (${pct(metric.value)})` : base;
}

export function ParagraphView({
  text,
  result,
}: {
  text: TextAnalysis;
  result: ReturnType<typeof useParagraphAnalysis>['result'];
}) {
  if (!result)
    return (
      <Empty
        icon={<Network size={20} />}
        title="Chưa có phân tích cấu trúc paragraph"
        hint="Chạy Phân tích cấu trúc paragraph (AI) ở bước 2 để thấy kiểu paragraph, ý chính, vai trò từng câu và mạch nối."
      />
    );
  const index = createOffsetIndex(text.sourceText);
  const quote = (span: { start: number; end: number } | null) =>
    span ? `“${index.sliceCp(span.start, span.end)}”` : 'Chưa xác định';
  const { paragraph, metrics } = result;
  const fractionKeys = Object.keys(metricLabels) as (keyof typeof metricLabels)[];
  const linked = result.flowLinks.filter((link) => link.measured && link.linked).length;
  return (
    <div className={styles.view}>
      <dl className={styles.summary}>
        <div>
          <dt>Kiểu paragraph</dt>
          <dd>
            <strong>{paragraph.type === 'UNKNOWN' ? 'Chưa xác định' : paragraph.type}</strong>
            <span className={styles.muted}>độ tin cậy {pct(paragraph.confidence)}</span>
          </dd>
        </div>
        <div>
          <dt>Ý chính</dt>
          <dd>
            <strong>{paragraph.centralPoint.identifiability}/4</strong>
            <span className={styles.muted}>
              {identifiabilityLabels[paragraph.centralPoint.identifiability]}
            </span>
          </dd>
        </div>
        <div>
          <dt>Cặp câu nối mạch</dt>
          <dd>
            <strong>
              {linked}/{result.flowLinks.length}
            </strong>
            <span className={styles.muted}>cặp có liên kết</span>
          </dd>
        </div>
        <div>
          <dt>Câu lạc đề</dt>
          <dd>
            <strong>{metrics.off_topic_sentence_count.numerator}</strong>
            <span className={styles.muted}>trên {text.sentences.length} câu</span>
          </dd>
        </div>
      </dl>

      <div className={styles.split}>
        <Card>
          <h2 className={styles.cardTitle}>Kiểu cấu trúc</h2>
          <ul className={styles.scores} aria-label="Điểm theo từng kiểu cấu trúc">
            {Object.entries(paragraph.typeScores).map(([type, score]) => (
              <li key={type} className={styles.score} data-top={type === paragraph.type || undefined}>
                <span>{type === 'UNKNOWN' ? 'Không rõ' : type}</span>
                <progress max={1} value={score} aria-label={`${type} ${pct(score)}`} />
                <span>{pct(score)}</span>
              </li>
            ))}
          </ul>
          {paragraph.rationale && <p className={styles.note}>{paragraph.rationale}</p>}
        </Card>
        <Card>
          <h2 className={styles.cardTitle} id="central-point">
            Ý chính
          </h2>
          <blockquote className={styles.central}>{quote(paragraph.centralPoint.span)}</blockquote>
          <p className={styles.note}>
            Mức rõ {paragraph.centralPoint.identifiability}/4 ·{' '}
            {identifiabilityLabels[paragraph.centralPoint.identifiability]}
            {paragraph.centralPoint.evidence ? ` · ${paragraph.centralPoint.evidence}` : ''}
          </p>
        </Card>
      </div>

      <Card>
        <h2 className={styles.cardTitle} id="sentence-roles">
          Vai trò từng câu
        </h2>
        <ol className={styles.roles} aria-labelledby="sentence-roles">
          {result.roles.map((role) => (
            <li key={role.sentenceId}>
              <span className={styles.sentenceId}>{role.sentenceId.toUpperCase()}</span>
              <Badge tone={role.role === 'off_topic' ? 'warning' : 'accent'}>{roleLabels[role.role]}</Badge>
              {role.rationale && <span className={styles.rationale}>{role.rationale}</span>}
              <span className={styles.confidence}>{pct(role.confidence)}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="flow-chain">
            Mạch đoạn
          </h2>
          <span className={styles.muted}>{text.sentences.map((s) => s.id.toUpperCase()).join(' → ')}</span>
        </div>
        <ol className={styles.flow} aria-labelledby="flow-chain">
          {result.flowLinks.map((link) => (
            <li
              key={`${link.fromSentenceId}-${link.toSentenceId}`}
              className={styles.pair}
              data-linked={link.measured ? link.linked : undefined}
            >
              <span className={styles.pairIcon} aria-hidden="true">
                {link.measured && link.linked ? <Link2 size={16} /> : <Unlink size={16} />}
              </span>
              <div className={styles.pairBody}>
                <div className={styles.row}>
                  <strong>
                    {link.fromSentenceId.toUpperCase()} → {link.toSentenceId.toUpperCase()}
                  </strong>
                  {!link.measured ? (
                    <Badge>Không có đánh giá của AI</Badge>
                  ) : (
                    <>
                      <Badge>{continuityLabels[link.continuity]}</Badge>
                      <Badge>{relationLabels[link.discourseRelation]}</Badge>
                      {link.linked ? (
                        <Badge tone="success">Có liên kết</Badge>
                      ) : (
                        <Badge tone="warning">Chưa liên kết</Badge>
                      )}
                    </>
                  )}
                </div>
                <span className={styles.quote}>
                  {quote(link.fromSpan)} → {quote(link.toSpan)}
                </span>
                {link.rationale && link.rationale !== 'no model output' && (
                  <span className={styles.note}>{link.rationale}</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <h2 className={styles.cardTitle} id="paragraph-metrics">
          Số liệu
        </h2>
        <dl className={styles.metrics} aria-labelledby="paragraph-metrics">
          {fractionKeys.map((key) => (
            <div key={key} className={styles.metric} title={key}>
              <dt>{metricLabels[key].label}</dt>
              <dd>{formatMetric(key, metrics[key])}</dd>
            </div>
          ))}
          {Object.entries(metrics.topic_continuity_pattern).map(([key, metric]) => (
            <div key={key} className={styles.metric} title={`topic_continuity_pattern.${key}`}>
              <dt>{continuityLabels[key as keyof typeof continuityLabels]}</dt>
              <dd>
                {metric.numerator}/{metric.denominator} cặp
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
