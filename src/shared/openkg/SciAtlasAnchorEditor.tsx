import { SCIATLAS_LEVELS, type SciAtlasAnchors, type SciAtlasLevel } from '@/core/openkg';
import { Button } from '@/shared/ui/Button';
import { Select } from '@/shared/ui/Select';
import styles from './sciatlas.module.css';

const LEVEL_LABELS: Record<SciAtlasLevel, string> = { high: 'Cao', middle: 'Vừa', low: 'Thấp' };

/** The anchors a search will send; each can be removed, and a keyword's level changed. */
export function SciAtlasAnchorEditor({
  anchors,
  onChange,
}: {
  anchors: SciAtlasAnchors;
  onChange: (anchors: SciAtlasAnchors) => void;
}) {
  const { keywords, titles, references } = anchors;
  const remove = <T,>(list: T[], index: number) => list.filter((_, i) => i !== index);
  return (
    <div className={styles.anchors} aria-label="Anchor sẽ gửi" role="group">
      <div>
        <h4>Keywords ({keywords.length})</h4>
        {keywords.length ? (
          <ul className={styles.anchorList}>
            {keywords.map((keyword, index) => (
              <li key={`${keyword.text}-${index}`}>
                <span className={styles.anchorText}>{keyword.text}</span>
                <Select
                  label={`Mức của keyword ${keyword.text}`}
                  hideLabel
                  inline
                  size="sm"
                  value={keyword.level}
                  onChange={(event) =>
                    onChange({
                      ...anchors,
                      keywords: keywords.map((item, i) =>
                        i === index ? { ...item, level: event.target.value as SciAtlasLevel } : item,
                      ),
                    })
                  }
                >
                  {SCIATLAS_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {LEVEL_LABELS[level]}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Bỏ keyword ${keyword.text}`}
                  onClick={() => onChange({ ...anchors, keywords: remove(keywords, index) })}
                >
                  Bỏ
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>Không có keyword nào.</p>
        )}
      </div>
      {titles.length > 0 && (
        <div>
          <h4>Title</h4>
          <ul className={styles.anchorList}>
            {titles.map((title, index) => (
              <li key={`${title.title}-${index}`}>
                <span className={styles.anchorText}>{title.title}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Bỏ title ${title.title}`}
                  onClick={() => onChange({ ...anchors, titles: remove(titles, index) })}
                >
                  Bỏ
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {references.length > 0 && (
        <details>
          <summary>References ({references.length})</summary>
          <ul className={styles.anchorList}>
            {references.map((reference, index) => (
              <li key={`${reference}-${index}`}>
                <span className={styles.anchorText}>{reference}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Bỏ reference ${reference}`}
                  onClick={() => onChange({ ...anchors, references: remove(references, index) })}
                >
                  Bỏ
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
