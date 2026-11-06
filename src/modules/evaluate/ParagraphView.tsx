import { Link2, Unlink } from 'lucide-react';
import type { TextAnalysis } from '@/core/schemas';
import type { ParagraphMetrics } from '@/core/schemas/paragraph';
import { createOffsetIndex } from '@/core/text';
import { Badge } from '@/shared/ui/Badge';
import { Card } from '@/shared/ui/Card';
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
      <Card>
        <p>Chưa có phân tích cấu trúc đoạn.</p>
      </Card>
    );
  const index = createOffsetIndex(text.sourceText);
  const quote = (span: { start: number; end: number } | null) =>
    span ? `“${index.sliceCp(span.start, span.end)}”` : 'Chưa xác định';
  const { paragraph } = result;
  const fractionKeys = Object.keys(metricLabels) as (keyof typeof metricLabels)[];
  return (
    <Card>
      <h2>Cấu trúc đoạn</h2>
      <div className={styles.summary}>
        <span>{paragraph.type === 'UNKNOWN' ? 'Chưa xác định' : paragraph.type}</span>
        <span className={styles.muted}>độ tin cậy {pct(paragraph.confidence)}</span>
      </div>
      <ul className={styles.scores} aria-label="Điểm theo từng kiểu cấu trúc">
        {Object.entries(paragraph.typeScores).map(([type, score]) => (
          <li key={type} className={styles.score}>
            <span>{type === 'UNKNOWN' ? 'Không rõ' : type}</span>
            <progress max={1} value={score} aria-label={`${type} ${pct(score)}`} />
            <span>{pct(score)}</span>
          </li>
        ))}
      </ul>
      {paragraph.rationale && <p className={styles.muted}>{paragraph.rationale}</p>}

      <section className={styles.section} aria-labelledby="central-point">
        <h3 id="central-point">Ý chính</h3>
        <p className={styles.quote}>{quote(paragraph.centralPoint.span)}</p>
        <p className={styles.muted}>
          Mức rõ {paragraph.centralPoint.identifiability}/4 ·{' '}
          {identifiabilityLabels[paragraph.centralPoint.identifiability]}
          {paragraph.centralPoint.evidence ? ` · ${paragraph.centralPoint.evidence}` : ''}
        </p>
      </section>

      <section className={styles.section} aria-labelledby="sentence-roles">
        <h3 id="sentence-roles">Vai trò câu</h3>
        <ul className={styles.list}>
          {result.roles.map((role) => (
            <li key={role.sentenceId} className={styles.row}>
              <span>{role.sentenceId.toUpperCase()}</span>
              <Badge tone={role.role === 'off_topic' ? 'warning' : 'neutral'}>{roleLabels[role.role]}</Badge>
              {role.rationale && <span className={styles.muted}>{role.rationale}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="flow-chain">
        <h3 id="flow-chain">Mạch đoạn</h3>
        <p className={styles.muted}>{text.sentences.map((s) => s.id.toUpperCase()).join(' → ')}</p>
        <ul className={styles.list}>
          {result.flowLinks.map((link) => (
            <li key={`${link.fromSentenceId}-${link.toSentenceId}`} className={styles.pair}>
              <div className={styles.row}>
                <strong>
                  {link.fromSentenceId.toUpperCase()} → {link.toSentenceId.toUpperCase()}
                </strong>
                <Badge>{continuityLabels[link.continuity]}</Badge>
                <Badge>{relationLabels[link.discourseRelation]}</Badge>
                {link.linked ? (
                  <Badge tone="success" icon={<Link2 size={14} aria-hidden="true" />}>
                    Có liên kết
                  </Badge>
                ) : (
                  <Badge tone="warning" icon={<Unlink size={14} aria-hidden="true" />}>
                    Chưa liên kết
                  </Badge>
                )}
              </div>
              <span className={styles.quote}>
                {quote(link.fromSpan)} → {quote(link.toSpan)}
              </span>
              {link.rationale && link.rationale !== 'no model output' && (
                <span className={styles.muted}>{link.rationale}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="paragraph-metrics">
        <h3 id="paragraph-metrics">Số liệu</h3>
        <ul className={styles.metrics}>
          {fractionKeys.map((key) => (
            <li key={key} className={styles.metric} title={key}>
              <span>{metricLabels[key].label}</span>
              <strong>{formatMetric(key, result.metrics[key])}</strong>
            </li>
          ))}
          {Object.entries(result.metrics.topic_continuity_pattern).map(([key, metric]) => (
            <li key={key} className={styles.metric} title={`topic_continuity_pattern.${key}`}>
              <span>{continuityLabels[key as keyof typeof continuityLabels]}</span>
              <strong>
                {metric.numerator}/{metric.denominator} cặp
              </strong>
            </li>
          ))}
        </ul>
      </section>
    </Card>
  );
}
