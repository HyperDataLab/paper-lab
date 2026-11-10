import type { Finding, Paper } from '@/core/schemas';
import { sliceCp } from '@/core/text/offsets';
import { Button } from '@/shared/ui/Button';
import { Drawer } from '@/shared/ui/Drawer';
import { placeLabel } from './paperLabels';
import styles from './page.module.css';

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
    <Drawer open={Boolean(location && paragraph)} onClose={onClose} label="Bằng chứng trong bài" side="right">
      {location && paragraph && (
        <div className={styles.evidence}>
          <header className={styles.evidenceHead}>
            <h2>{placeLabel(paper, paragraph.id)}</h2>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Đóng
            </Button>
          </header>
          <p className={styles.evidenceText}>
            {sliceCp(paragraph.text, 0, location.start)}
            <mark>{sliceCp(paragraph.text, location.start, location.end)}</mark>
            {sliceCp(paragraph.text, location.end, Array.from(paragraph.text).length)}
          </p>
          <Button onClick={() => onOpenReader(location)}>Mở trong Đọc bài</Button>
        </div>
      )}
    </Drawer>
  );
}
