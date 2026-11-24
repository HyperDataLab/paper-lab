import { Button } from '@/shared/ui/Button';
import { BlurField } from './BlurField';
import type { Props } from './types';
export function NeighboursEditor({ check, change }: Props) {
  return (
    <section className="topic-neighbours">
      <div className="topic-neighbours-head">
        <h3>Bài gần nhất</h3>
        <Button
          id={check.neighbours.length === 0 ? 'topic-neighbours' : undefined}
          size="sm"
          disabled={check.neighbours.length >= 10}
          onClick={() =>
            change((c) => ({
              ...c,
              neighbours: [...c.neighbours, { ref: '', label: '', difference: '', source: 'researcher' }],
            }))
          }
        >
          + Thêm bài
        </Button>
      </div>
      {check.neighbours.length === 0 && <p className="topic-neighbours-empty">Chưa có bài gần nhất.</p>}
      {check.neighbours.map((n, i) => (
        <div className="topic-neighbour-row" key={`${check.neighbours.length}-${i}`}>
          {(['ref', 'label', 'difference'] as const).map((field) => (
            <BlurField
              key={field}
              id={i === 0 && field === 'ref' ? 'topic-neighbours' : undefined}
              label={`${{ ref: 'DOI hoặc OpenAlex ID', label: 'Tên bài', difference: 'Điểm khác biệt' }[field]} ${i + 1}`}
              value={n[field]}
              multiline={field === 'difference'}
              rows={2}
              save={(value) =>
                change((c) => ({
                  ...c,
                  neighbours: c.neighbours.map((entry, index) =>
                    index === i ? { ...entry, [field]: value } : entry,
                  ),
                }))
              }
            />
          ))}
          <Button
            variant="ghost"
            className="topic-neighbour-remove"
            onClick={() =>
              change((c) => ({ ...c, neighbours: c.neighbours.filter((_, index) => index !== i) }))
            }
          >
            Xoá bài {i + 1}
          </Button>
        </div>
      ))}
    </section>
  );
}
