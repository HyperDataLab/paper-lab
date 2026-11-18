import type { KgEdge, KgNode } from '@/core/openkg';
import type { Finding, PaperModelSentence } from '@/core/schemas';
import type { ReactNode } from 'react';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { edgeKey, PREDICATE_LABELS, PROVENANCE_LABELS } from './labels';
import styles from './openkg.module.css';

export function OpenKgTriples({
  edges,
  nodes,
  sentences,
  onLocation,
  renderDetails,
}: {
  edges: KgEdge[];
  nodes: ReadonlyMap<string, KgNode>;
  sentences?: ReadonlyMap<string, PaperModelSentence>;
  onLocation?: (location: Finding['locations'][number]) => void;
  renderDetails?: (edge: KgEdge) => ReactNode;
}) {
  if (!edges.length) return <p className={styles.muted}>Không có bộ ba đang hiển thị.</p>;
  return (
    <ul className={styles.triples}>
      {edges.map((edge) => (
        <li key={edgeKey(edge)}>
          <div className={styles.triple}>
            <strong>{nodes.get(edge.s)?.label}</strong>
            {' · '}
            <span className={styles.muted}>{PREDICATE_LABELS[edge.p]}</span>
            {' · '}
            <strong>{nodes.get(edge.o)?.label}</strong>{' '}
            <Badge tone={edge.provenance === 'accepted' ? 'success' : 'neutral'}>
              {PROVENANCE_LABELS[edge.provenance]}
            </Badge>
          </div>
          {renderDetails?.(edge)}
          {edge.evidence?.map((key) => {
            const sentence = sentences?.get(key);
            if (!sentence || !onLocation) return null;
            const { paragraphId, start, end } = sentence;
            return (
              <div key={key} className={styles.evidence}>
                <blockquote>{sentence.text}</blockquote>
                <Button variant="ghost" size="sm" onClick={() => onLocation({ paragraphId, start, end })}>
                  Xem trong bài
                </Button>
              </div>
            );
          })}
        </li>
      ))}
    </ul>
  );
}
