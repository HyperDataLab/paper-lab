import { useState } from 'react';
import type { PaperModelSentence } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import styles from './scg.module.css';

export function ScgEvidence({
  keys,
  sentences,
  sections,
  onLocation,
  prefix,
}: {
  keys: string[];
  sentences: Map<string, PaperModelSentence>;
  sections: Map<string, string>;
  onLocation: (location: { paragraphId: string; start: number; end: number }) => void;
  prefix: string;
}) {
  const evidence = keys.flatMap((key) => {
    const sentence = sentences.get(key);
    return sentence ? [{ sentence, section: sections.get(sentence.sectionId) }] : [];
  });

  if (!evidence.length) return <p className={styles.muted}>Không còn trích dẫn nguồn để đối chiếu.</p>;

  return (
    <div className={styles.evidenceList}>
      {evidence.map(({ sentence, section }, index) => {
        return (
          <EvidenceItem
            key={sentence.key}
            sentence={sentence}
            section={section}
            onLocation={onLocation}
            quoteId={`${prefix}-quote-${index}`}
          />
        );
      })}
    </div>
  );
}

function EvidenceItem({
  sentence,
  section,
  onLocation,
  quoteId,
}: {
  sentence: PaperModelSentence;
  section?: string;
  onLocation: (location: { paragraphId: string; start: number; end: number }) => void;
  quoteId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = sentence.text.length > 360;
  return (
    <div className={styles.evidence}>
      <blockquote id={quoteId} className={expanded ? styles.quoteExpanded : styles.quotePreview}>
        {sentence.text}
      </blockquote>
      <div className={styles.evidenceMeta}>
        <span>{section || 'Section chưa xác định'}</span>
        {sentence.page && <span>Trang {sentence.page}</span>}
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onLocation({ paragraphId: sentence.paragraphId, start: sentence.start, end: sentence.end })
          }
        >
          Xem trong bài
        </Button>
        {canExpand && (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            aria-controls={quoteId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Thu gọn' : 'Xem thêm'}
          </Button>
        )}
      </div>
    </div>
  );
}
