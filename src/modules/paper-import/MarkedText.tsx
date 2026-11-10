import { segmentText, type FindingLocation, type PaperMark } from '@/core/paperFindings';
import { CRITERIA } from './criteria';
import styles from './page.module.css';

/**
 * A paragraph with what was found in it drawn on the words themselves. Each criterion has its own underline
 * style as well as its colour; the passage a reader just opened is a `<mark>`. Pressing a marked stretch
 * opens what it stands for.
 */
export function MarkedText({
  text,
  marks,
  selected,
  onMark,
}: {
  text: string;
  /** Marks of this paragraph, already limited to the layers that are switched on. */
  marks: PaperMark[];
  /** The passage opened from a finding or a quote, if it lies in this paragraph. */
  selected?: FindingLocation | null;
  onMark?: (mark: PaperMark) => void;
}) {
  const picked: PaperMark[] = selected
    ? [{ ...selected, id: '__selected', criterion: 'claim', label: '', findingId: null, view: '' }]
    : [];
  const segments = segmentText(text, [...marks, ...picked]);
  return (
    <>
      {segments.map((segment, index) => {
        const isSelected = segment.marks.some((mark) => mark.id === '__selected');
        const real = segment.marks.filter((mark) => mark.id !== '__selected');
        const top = real[0];
        if (!top) return isSelected ? <mark key={index}>{segment.text}</mark> : segment.text;
        const Tag = isSelected ? 'mark' : 'span';
        const open = () => onMark?.(top);
        return (
          <Tag
            key={index}
            className={styles.textMark}
            data-criterion={top.criterion}
            data-finding={top.findingId !== null}
            role="button"
            tabIndex={0}
            title={real.map((mark) => `${CRITERIA[mark.criterion].label}: ${mark.label}`).join('\n')}
            onClick={open}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              open();
            }}
          >
            {segment.text}
            {real.length > 1 && <sup className={styles.textMarkMore}>+{real.length - 1}</sup>}
          </Tag>
        );
      })}
    </>
  );
}
