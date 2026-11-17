import type { Paper } from '@/core/topicCheck/evidence';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import type { Props } from './types';

export function PaperRow({
  paper,
  check,
  change,
  review = false,
}: Props & { paper: Paper; review?: boolean }) {
  const ref = paper.doi ?? paper.id;
  const added = check.neighbours.some(
    (n) => n.ref === ref || n.ref === paper.id || (paper.doi && n.ref === paper.doi),
  );
  const reviewed = (check.reviewedIds ?? []).includes(paper.id);
  return (
    <li>
      <a href={paper.url} target="_blank" rel="noopener noreferrer">
        {paper.title ?? paper.id}
      </a>{' '}
      {[paper.year, paper.venue?.name, `${paper.cited_by_count} trích dẫn`].filter(Boolean).join(' · ')}{' '}
      {paper.type && <Badge>{paper.type}</Badge>}{' '}
      {paper.study_design?.map((design) => (
        <Badge key={design}>{design}</Badge>
      ))}{' '}
      {paper.retracted && <Badge tone="danger">Đã rút lại</Badge>}{' '}
      <Button
        size="sm"
        disabled={!!added || check.neighbours.length >= 10}
        onClick={() =>
          change((c) =>
            c.neighbours.length >= 10 || c.neighbours.some((n) => n.ref === ref || n.ref === paper.id)
              ? c
              : {
                  ...c,
                  neighbours: [
                    ...c.neighbours,
                    { ref, label: paper.title ?? paper.id, difference: '', source: 'tool' },
                  ],
                },
          )
        }
      >
        Thêm vào bài gần nhất
      </Button>
      {review && (
        <Checkbox
          checked={reviewed}
          disabled={!reviewed && (check.reviewedIds ?? []).length >= 50}
          onChange={() =>
            change((c) => ({
              ...c,
              reviewedIds: reviewed
                ? (c.reviewedIds ?? []).filter((id) => id !== paper.id)
                : [...(c.reviewedIds ?? []), paper.id].slice(0, 50),
            }))
          }
        >
          Đã đọc
        </Checkbox>
      )}
    </li>
  );
}
