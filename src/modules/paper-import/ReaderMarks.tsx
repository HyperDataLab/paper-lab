import type { Criterion, PaperMark } from '@/core/paperFindings';
import { Chip } from '@/shared/ui/Chip';
import { CRITERIA } from './criteria';
import { CriterionMark } from './SectionBlock';
import styles from './page.module.css';

const criteria = Object.keys(CRITERIA) as Criterion[];

export function LayerChips({
  marks,
  layers,
  onLayers,
}: {
  marks: PaperMark[];
  layers: Criterion[];
  onLayers: (layers: Criterion[]) => void;
}) {
  if (!marks.length) return null;
  return (
    <div className={styles.blockChips} role="group" aria-label="Lớp đánh dấu trên bài">
      {criteria.map((id) => (
        <Chip
          key={id}
          aria-pressed={layers.includes(id)}
          count={marks.filter((mark) => mark.criterion === id).length}
          onClick={() =>
            onLayers(layers.includes(id) ? layers.filter((item) => item !== id) : [...layers, id])
          }
        >
          <CriterionMark criterion={id} />
          {CRITERIA[id].label}
        </Chip>
      ))}
    </div>
  );
}

export function MarkGutter({ marks }: { marks: PaperMark[] }) {
  return (
    <span className={styles.gutter}>
      {criteria
        .filter((id) => marks.some((mark) => mark.criterion === id))
        .map((id) => (
          <CriterionMark key={id} criterion={id} />
        ))}
    </span>
  );
}
