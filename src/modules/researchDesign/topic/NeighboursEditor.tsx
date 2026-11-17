import { Card } from '@/shared/ui/Card';
import { Button } from '@/shared/ui/Button';
import { BlurField } from './BlurField';
import type { Props } from './types';
export function NeighboursEditor({ check, change }: Props) {
  return (
    <Card>
      <h3>Bài gần nhất</h3>
      {check.neighbours.map((n, i) => (
        <div key={`${check.neighbours.length}-${i}`}>
          {(['ref', 'label', 'difference'] as const).map((field) => (
            <BlurField
              key={field}
              label={`${{ ref: 'DOI hoặc OpenAlex ID', label: 'Tên bài', difference: 'Điểm khác biệt' }[field]} ${i + 1}`}
              value={n[field]}
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
            onClick={() =>
              change((c) => ({ ...c, neighbours: c.neighbours.filter((_, index) => index !== i) }))
            }
          >
            Xoá bài {i + 1}
          </Button>
        </div>
      ))}
      <Button
        disabled={check.neighbours.length >= 10}
        onClick={() =>
          change((c) => ({
            ...c,
            neighbours: [...c.neighbours, { ref: '', label: '', difference: '', source: 'researcher' }],
          }))
        }
      >
        Thêm bài gần nhất
      </Button>
    </Card>
  );
}
