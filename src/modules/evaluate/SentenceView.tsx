import type { ReactNode } from 'react';
import { classifyGap, SV_GAP_HIGH, SV_GAP_REVIEW } from '@/core/analysis';
import type { Sentence, SentenceAnnotation, Span } from '@/core/schemas';
import type { createOffsetIndex } from '@/core/text';
import styles from './syntax.module.css';

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
    <span className={`${styles.chip} ${label === 'review' || label === 'high' ? styles.chipReview : ''}`}>
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
  const part = (name: string, span: Span | null) => (
    <span className={uncertain ? styles.uncertain : undefined}>
      {name}: {span ? index.sliceCp(span.start, span.end) : 'Chưa xác định'}
      {uncertain && ' ?'}
    </span>
  );
  return (
    <>
      <p className={styles.sentence}>{renderMarked(index, sentence, marks)}</p>
      <div className={styles.badges}>
        {part('T', annotation.topicSpan)} · {part('A', annotation.actionSpan)} ·{' '}
        {part('S', annotation.stressSpan)}
      </div>
      <div className={styles.badges}>
        <GapChip annotation={annotation} />
        {annotation.voice && <span>{annotation.voice === 'passive' ? 'Bị động' : 'Chủ động'}</span>}
        {annotation.clauseCount !== null && (
          <span>
            Mệnh đề: {annotation.clauseCount}
            {annotation.maxClauseDepth !== null && ` · độ sâu ${annotation.maxClauseDepth}`}
          </span>
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
