import { LENSES } from '@/core/prompts';
import type { Paper, PaperReviewRun, ReviewDecision } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { FindingCard, ReviewActions } from '@/shared/ui/FindingCard';
import { placeLabel } from './paperLabels';
import styles from './page.module.css';
import { DIMENSION_LABELS, KIND_LABELS, SEVERITY_LABELS } from './reviewLabels';

type Point = PaperReviewRun['merged'][number];
export function ReviewPointCard({
  paper,
  point,
  decision,
  templates,
  onLocation,
  onReview,
}: {
  paper: Paper;
  point: Point;
  decision?: ReviewDecision;
  templates: string[];
  onLocation: (location: Point['anchor']) => void;
  onReview: (id: string, status: ReviewDecision['status'] | 'candidate') => void;
}) {
  const normalized = (value: string) => (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');
  const warning = point.wordings.some((wording) =>
    templates.some((phrase) =>
      [wording.point, wording.rationale, wording.quote].some((text) => normalized(text).includes(phrase)),
    ),
  );
  const first = point.wordings[0];
  const state =
    decision?.status === 'confirmed_by_human'
      ? 'confirmed'
      : decision?.status === 'dismissed_by_human'
        ? 'dismissed'
        : 'open';
  return (
    <FindingCard
      state={state}
      labels={
        <>
          {first && <Badge tone="accent">{KIND_LABELS[first.kind]}</Badge>}
          {first && <Badge>{DIMENSION_LABELS[first.dimension]}</Badge>}
          <Badge
            tone={
              point.severity === 'major' ? 'danger' : point.severity === 'moderate' ? 'warning' : 'neutral'
            }
          >
            {SEVERITY_LABELS[point.severity]}
          </Badge>
          {point.lenses.map((lens) => (
            <Badge key={lens}>{LENSES[lens].label}</Badge>
          ))}
          {warning && <Badge tone="warning">Cụm khuôn mẫu</Badge>}
          {decision && (
            <Badge tone={state === 'confirmed' ? 'success' : 'neutral'}>
              {state === 'confirmed' ? 'Đã xác nhận' : 'Đã bác bỏ'}
            </Badge>
          )}
        </>
      }
      quote={first ? `“${first.quote}”` : undefined}
      source={{ label: placeLabel(paper, point.anchor.paragraphId), onOpen: () => onLocation(point.anchor) }}
      actions={
        <ReviewActions
          acceptByDefault
          decided={Boolean(decision)}
          onConfirm={() => onReview(point.id, 'confirmed_by_human')}
          onDismiss={() => onReview(point.id, 'dismissed_by_human')}
          onUndo={() => onReview(point.id, 'candidate')}
        />
      }
    >
      {point.wordings.map((wording, index) => (
        <div key={`${wording.lens}-${index}`}>
          {point.wordings.length > 1 && <strong>{LENSES[wording.lens].label}</strong>}
          <p>{wording.point}</p>
          <p className={styles.muted}>{wording.rationale}</p>
        </div>
      ))}
    </FindingCard>
  );
}
