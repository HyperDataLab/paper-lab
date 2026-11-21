import { BookOpen } from 'lucide-react';
import type { Finding, Paper } from '@/core/schemas';
import { sliceCp } from '@/core/text/offsets';
import { Button } from '@/shared/ui/Button';
import { Drawer } from '@/shared/ui/Drawer';
import styles from './page.module.css';
import { PlaceText } from './PlaceText';

type Location = Finding['locations'][number];

/** Shows a finding in its paragraph without leaving the screen the reader is working on. */
export function EvidencePanel({
  paper,
  location,
  onClose,
  onOpenReader,
}: {
  paper: Paper;
  location: Location | null;
  onClose: () => void;
  onOpenReader: (location: Location) => void;
}) {
  const paragraph = paper.paragraphs.find((item) => item.id === location?.paragraphId);
  return (
    <Drawer
      open={Boolean(location && paragraph)}
      onClose={onClose}
      label="Evidence trong bài"
      side="right"
      title="Evidence trong bài"
      description={paragraph ? <PlaceText paper={paper} paragraphId={paragraph.id} /> : undefined}
      footer={
        location ? (
          <Button variant="primary" onClick={() => onOpenReader(location)}>
            <BookOpen size={16} aria-hidden="true" />
            {paper.source.kind === 'pdf' ? 'Mở trong PDF' : 'Mở trong bài'}
          </Button>
        ) : undefined
      }
    >
      {location && paragraph && (
        <p className={styles.evidenceText}>
          {sliceCp(paragraph.text, 0, location.start)}
          <mark>{sliceCp(paragraph.text, location.start, location.end)}</mark>
          {sliceCp(paragraph.text, location.end, Array.from(paragraph.text).length)}
        </p>
      )}
    </Drawer>
  );
}
