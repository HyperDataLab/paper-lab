import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { Generation } from '@/core/schemas';
import { sliceCp } from '@/core/text';
import { Badge } from '@/shared/ui/Badge';
import { Card } from '@/shared/ui/Card';
import { Chip } from '@/shared/ui/Chip';
import { roleLabels } from '@/modules/evaluate';
import styles from './page.module.css';

import { checkLabels } from './checkLabels';

export function GenerationResult({
  generation,
  highlight,
}: {
  generation: Generation | null;
  highlight: (id: string | null) => void;
}) {
  return (
    <>
      <Card>
        <h2>Đoạn đã soạn</h2>
        {generation ? (
          <div className={styles.reading}>
            {generation.sentences.map((sentence, index) => {
              const checks = generation.checks.sentences[index]?.checks ?? [];
              const failed = checks.some((check) => check.status === 'fail');
              const previous = generation.sentences[index - 1]?.span.end ?? 0;
              return (
                <span key={`${sentence.span.start}-${sentence.span.end}`}>
                  {sliceCp(generation.paragraph, previous, sentence.span.start)}
                  <span className={failed ? styles.critical : undefined}>{sentence.text}</span>
                  {failed && (
                    <span className={styles.warning}>
                      <AlertTriangle size={16} aria-hidden="true" /> Cần kiểm tra nguồn
                    </span>
                  )}{' '}
                  <Badge>{roleLabels[sentence.role]}</Badge>{' '}
                  {sentence.evidenceIds.map((id) => (
                    <Chip
                      key={id}
                      onMouseEnter={() => highlight(id)}
                      onMouseLeave={() => highlight(null)}
                      onFocus={() => highlight(id)}
                      onBlur={() => highlight(null)}
                      aria-label={`Bằng chứng ${id}`}
                    >
                      {id}
                    </Chip>
                  ))}
                </span>
              );
            })}
            {sliceCp(
              generation.paragraph,
              generation.sentences.at(-1)?.span.end ?? 0,
              Array.from(generation.paragraph).length,
            )}
          </div>
        ) : (
          <p>Nhập luận điểm và bằng chứng để soạn đoạn.</p>
        )}
      </Card>
      <Card>
        <h2>Kiểm tra nguồn</h2>
        {generation ? (
          <>
            <ul className={styles.checks}>
              {generation.checks.overall.map((check) => (
                <li key={check.id}>
                  {check.status === 'pass' ? (
                    <CheckCircle2 size={16} aria-hidden="true" />
                  ) : check.status === 'warn' ? (
                    <AlertTriangle size={16} aria-hidden="true" />
                  ) : check.status === 'fail' ? (
                    <XCircle size={16} aria-hidden="true" />
                  ) : (
                    <Info size={16} aria-hidden="true" />
                  )}{' '}
                  {check.status === 'pass'
                    ? 'Đạt'
                    : check.status === 'warn'
                      ? 'Cảnh báo'
                      : check.status === 'fail'
                        ? 'Không đạt'
                        : 'Thông tin'}{' '}
                  · {checkLabels[check.id] ?? check.id}
                  {check.detail && `: ${check.detail}`}
                </li>
              ))}
            </ul>
            {generation.checks.unanchored.length > 0 && (
              <>
                <h3>Câu không khớp với đoạn</h3>
                <ul>
                  {generation.checks.unanchored.map((item) => (
                    <li key={item.sentenceIndex}>
                      Không đạt · {item.check.detail} “{item.text}”
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h3>Bằng chứng chưa dùng</h3>
            <p>{generation.checks.unusedEvidence.join(', ') || 'Không có.'}</p>
            <h3>Cần bằng chứng từ bạn</h3>
            {generation.needsEvidence.length ? (
              <ul>
                {generation.needsEvidence.map((item, index) => (
                  <li key={index}>{item.note}</li>
                ))}
              </ul>
            ) : (
              <p>Không có.</p>
            )}
          </>
        ) : (
          <p>Chưa có kết quả.</p>
        )}
      </Card>
    </>
  );
}
