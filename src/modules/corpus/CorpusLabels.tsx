import type { Corpus } from '@/core/schemas/corpus';
import { CorpusLabelling } from './CorpusLabelling';
import { LabelCoverage } from './LabelCoverage';
import { LabelReview } from './LabelReview';
import { useLabelPapers } from './useLabelPapers';
import styles from './corpus.module.css';

/** Corpus-wide machine labels: the run, its coverage, and the human check of a sample. */
export function CorpusLabels({ corpus, save }: { corpus: Corpus; save: (value: Corpus) => Promise<void> }) {
  const items = useLabelPapers(corpus);
  return (
    <>
      <CorpusLabelling corpus={corpus} items={items} save={save} />
      <div className={styles.lower}>
        <LabelCoverage items={items} />
        <LabelReview corpus={corpus} items={items} save={save} />
      </div>
    </>
  );
}
