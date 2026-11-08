import type { CheckDecision, Finding, Paper } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import type { CheckHandlers } from './checkTypes';
export function FindingRow({
  finding,
  paper,
  decision,
  onReview,
  onLocation,
}: {
  finding: Finding;
  paper: Paper;
  decision?: CheckDecision;
  onReview: CheckHandlers['onReview'];
  onLocation: CheckHandlers['onLocation'];
}) {
  return (
    <li>
      {decision?.status === 'dismissed_by_human' ? <s>{finding.message}</s> : <span>{finding.message}</span>}
      {decision?.status === 'confirmed_by_human' && <Badge tone="success">Đã xác nhận</Badge>}
      <ul>
        {finding.locations.map((location, index) => {
          const paragraph = paper.paragraphs.find((p) => p.id === location.paragraphId);
          const quote = paragraph
            ? Array.from(paragraph.text).slice(location.start, location.end).join('')
            : '';
          return (
            <li key={`${location.paragraphId}:${location.start}:${index}`}>
              <Button variant="ghost" onClick={() => onLocation(location)}>
                {location.paragraphId}: “{quote}”
              </Button>
            </li>
          );
        })}
      </ul>
      {decision ? (
        <Button size="sm" onClick={() => onReview(finding.id, 'candidate')}>
          Hoàn tác
        </Button>
      ) : (
        <>
          <Button size="sm" onClick={() => onReview(finding.id, 'confirmed_by_human')}>
            Xác nhận
          </Button>{' '}
          <Button size="sm" onClick={() => onReview(finding.id, 'dismissed_by_human')}>
            Bỏ qua
          </Button>
        </>
      )}
    </li>
  );
}
