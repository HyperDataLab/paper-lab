import type { KgEdge } from '@/core/openkg';
import { PROVENANCE_LABELS } from '@/shared/ui/openkg/labels';
import styles from '@/shared/ui/openkg/openkg.module.css';
import corpusStyles from './corpus-openkg.module.css';

const number = new Intl.NumberFormat('vi', { maximumFractionDigits: 2 });

export function OpenKgSupport({ edge, papers }: { edge: KgEdge; papers: ReadonlyMap<string, string> }) {
  const sources = new Map<string, Set<string>>();
  for (const { paper, provenance } of edge.support ?? []) {
    const kinds = sources.get(paper) ?? new Set();
    kinds.add(PROVENANCE_LABELS[provenance]);
    sources.set(paper, kinds);
  }
  return (
    <div className={styles.evidence}>
      <span className={styles.muted}>
        {edge.supportCount} bài làm căn cứ
        {edge.weight !== undefined && ` · Jaccard ${number.format(edge.weight)}`}
        {edge.keywordScore !== undefined && ` · Điểm keyword ${number.format(edge.keywordScore)}`}
      </span>
      <ul className={corpusStyles.support} aria-label="Bài báo làm căn cứ">
        {[...sources].map(([id, origins]) => (
          <li key={id}>
            {papers.get(id)} · {[...origins].join(', ')}
          </li>
        ))}
      </ul>
    </div>
  );
}
