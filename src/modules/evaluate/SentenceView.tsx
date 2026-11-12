import type { ReactNode } from 'react';
import { classifyGap, SV_GAP_HIGH, SV_GAP_REVIEW } from '@/core/analysis';
import type { Sentence, SentenceAnnotation, Span } from '@/core/schemas';
import type { createOffsetIndex } from '@/core/text';
import styles from './sentences.module.css';

type OffsetIndex = ReturnType<typeof createOffsetIndex>;
type Mark = { span: Span; className: string | undefined; label: string };
const UNCERTAIN = 0.6;

/** Splits the sentence into plain text and marked spans; overlapping marks after the first are skipped. */
function renderMarked(index: OffsetIndex, sentence: Sentence, marks: Mark[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = sentence.start;
  const sorted = [...marks].sort((a, b) => a.span.start - b.span.start);
  for (const mark of sorted) {
    if (mark.span.start < cursor || mark.span.end > sentence.end) continue;
    if (mark.span.start > cursor) nodes.push(index.sliceCp(cursor, mark.span.start));
    nodes.push(
      <mark key={mark.span.start} className={mark.className} aria-label={mark.label} title={mark.label}>
        {index.sliceCp(mark.span.start, mark.span.end)}
      </mark>,
    );
    cursor = mark.span.end;
  }
  if (cursor < sentence.end) nodes.push(index.sliceCp(cursor, sentence.end));
  return nodes;
}

function GapChip({ annotation }: { annotation: SentenceAnnotation }) {
  const distance = annotation.subjectVerbDistanceTokens;
  const label = classifyGap(distance);
  return (
    <span className={`${styles.fact} ${label === 'review' || label === 'high' ? styles.factReview : ''}`}>
      Khoảng cách chủ–vị: {distance === null ? '—' : `${distance} token`}
      {label === 'review' && ` · Cần xem lại (ngưỡng thử nghiệm ≥ ${SV_GAP_REVIEW})`}
      {label === 'high' && ` · Ưu tiên xem lại (≥ ${SV_GAP_HIGH})`}
    </span>
  );
}

export function SentenceView({
  index,
  sentence,
  annotation,
}: {
  index: OffsetIndex;
  sentence: Sentence;
  annotation?: SentenceAnnotation;
}) {
  if (!annotation) return <p className={styles.sentence}>{index.sliceCp(sentence.start, sentence.end)}</p>;
  const marks: Mark[] = [];
  if (annotation.subjectSpan)
    marks.push({ span: annotation.subjectSpan, className: styles.subject, label: 'Chủ ngữ' });
  if (annotation.interveningSpan)
    marks.push({ span: annotation.interveningSpan, className: styles.gap, label: 'Phần xen giữa chủ–vị' });
  if (annotation.verbSpan)
    marks.push({ span: annotation.verbSpan, className: styles.verb, label: 'Động từ chính' });
  const uncertain = annotation.parseConfidence !== null && annotation.parseConfidence < UNCERTAIN;
  const part = (name: string, hint: string, span: Span | null) => (
    <div className={uncertain ? styles.uncertain : undefined}>
      <dt title={hint}>{name}</dt>
      <dd title={uncertain ? 'Độ tin cậy thấp, cần kiểm tra lại' : undefined}>
        {span ? index.sliceCp(span.start, span.end) : 'Chưa xác định'}
        {uncertain && ' ?'}
      </dd>
    </div>
  );
  return (
    <>
      <p className={styles.sentence}>{renderMarked(index, sentence, marks)}</p>
      <dl className={styles.tas}>
        {part('Topic', 'Chủ đề: phần mở câu, nối với câu trước', annotation.topicSpan)}
        {part('Action', 'Hành động: động từ mang việc câu kể', annotation.actionSpan)}
        {part('Stress', 'Điểm nhấn: phần cuối câu, nơi đặt thông tin mới', annotation.stressSpan)}
      </dl>
      <div className={styles.facts}>
        <GapChip annotation={annotation} />
        {annotation.voice && (
          <span className={styles.fact}>{annotation.voice === 'passive' ? 'Bị động' : 'Chủ động'}</span>
        )}
        {annotation.clauseCount !== null && (
          <span className={styles.fact}>
            Mệnh đề: {annotation.clauseCount}
            {annotation.maxClauseDepth !== null && ` · độ sâu ${annotation.maxClauseDepth}`}
          </span>
        )}
        {annotation.parseConfidence !== null && (
          <span className={styles.fact}>Tin cậy {Math.round(annotation.parseConfidence * 100)} %</span>
        )}
      </div>
      {annotation.unresolved.length > 0 && (
        <details className={styles.unresolved}>
          <summary>Chưa xác định được ({annotation.unresolved.length})</summary>
          <ul>
            {annotation.unresolved.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
