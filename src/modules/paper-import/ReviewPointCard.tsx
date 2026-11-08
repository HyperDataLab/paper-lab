import { LENSES } from '@/core/prompts';
import type { PaperReviewRun, ReviewDecision } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { DIMENSION_LABELS, KIND_LABELS, SEVERITY_LABELS } from './reviewLabels';

type Point = PaperReviewRun['merged'][number];
export function ReviewPointCard({
  point,
  decision,
  templates,
  onLocation,
  onReview,
}: {
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
  return (
    <Card>
      {point.wordings.map((wording, index) => (
        <span key={`${wording.lens}-${index}`}>
          <Badge>{KIND_LABELS[wording.kind]}</Badge> <Badge>{DIMENSION_LABELS[wording.dimension]}</Badge>{' '}
        </span>
      ))}
      <Badge>{SEVERITY_LABELS[point.severity]}</Badge>{' '}
      {point.lenses.map((lens) => (
        <Badge key={lens}>{LENSES[lens].label}</Badge>
      ))}
      <p>
        <Button variant="ghost" onClick={() => onLocation(point.anchor)}>
          {point.anchor.paragraphId}: “{point.wordings[0]?.quote}”
        </Button>
      </p>
      {point.wordings.map((wording, index) => (
        <div key={`${wording.lens}-${index}`}>
          <strong>{LENSES[wording.lens].label}</strong>
          <p>{wording.point}</p>
          <p>{wording.rationale}</p>
        </div>
      ))}
      {warning && <p>Cụm khuôn mẫu</p>}
      {decision ? (
        <>
          <p>{decision.status === 'confirmed_by_human' ? 'Đã xác nhận' : 'Đã bỏ qua'}</p>
          <Button size="sm" onClick={() => onReview(point.id, 'candidate')}>
            Hoàn tác
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" onClick={() => onReview(point.id, 'confirmed_by_human')}>
            Xác nhận
          </Button>{' '}
          <Button size="sm" onClick={() => onReview(point.id, 'dismissed_by_human')}>
            Bỏ qua
          </Button>
        </>
      )}
    </Card>
  );
}
