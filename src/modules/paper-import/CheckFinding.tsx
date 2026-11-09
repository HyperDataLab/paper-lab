import type { CheckDecision, Finding, Paper } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { FindingCard, ReviewActions } from '@/shared/ui/FindingCard';
import type { CheckHandlers } from './checkTypes';
import { placeLabel } from './paperLabels';
import styles from './page.module.css';

export function FindingRow({
  finding,
  label,
  hideMessage = false,
  paper,
  decision,
  onReview,
  onLocation,
}: {
  finding: Finding;
  label: string;
  hideMessage?: boolean;
  paper: Paper;
  decision?: CheckDecision;
  onReview: CheckHandlers['onReview'];
  onLocation: CheckHandlers['onLocation'];
}) {
  const quoteOf = (location: Finding['locations'][number]) => {
    const paragraph = paper.paragraphs.find((p) => p.id === location.paragraphId);
    return paragraph ? Array.from(paragraph.text).slice(location.start, location.end).join('') : '';
  };
  const [first, ...others] = finding.locations;
  const state =
    decision?.status === 'confirmed_by_human'
      ? 'confirmed'
      : decision?.status === 'dismissed_by_human'
        ? 'dismissed'
        : 'open';
  return (
    <li>
      <FindingCard
        state={state}
        labels={
          <>
            <Badge>{label}</Badge>
            {state !== 'open' && (
              <Badge tone={state === 'confirmed' ? 'success' : 'neutral'}>
                {state === 'confirmed' ? 'Đã xác nhận' : 'Đã bỏ qua'}
              </Badge>
            )}
          </>
        }
        quote={first ? `“${quoteOf(first)}”` : undefined}
        source={
          first ? { label: placeLabel(paper, first.paragraphId), onOpen: () => onLocation(first) } : undefined
        }
        actions={
          <ReviewActions
            decided={Boolean(decision)}
            onConfirm={() => onReview(finding.id, 'confirmed_by_human')}
            onDismiss={() => onReview(finding.id, 'dismissed_by_human')}
            onUndo={() => onReview(finding.id, 'candidate')}
          />
        }
      >
        {!hideMessage && <p>{finding.message}</p>}
        {others.length > 0 && (
          <details>
            <summary>Xuất hiện thêm ở {others.length} vị trí</summary>
            <ul className={styles.locations}>
              {others.map((location, index) => (
                <li key={`${location.paragraphId}:${location.start}:${index}`}>
                  <Button size="sm" variant="ghost" onClick={() => onLocation(location)}>
                    {placeLabel(paper, location.paragraphId)}
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </FindingCard>
    </li>
  );
}
