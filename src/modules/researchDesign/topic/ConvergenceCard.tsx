import { Card } from '@/shared/ui/Card';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { BlurField } from './BlurField';
import type { Props } from './types';
export function ConvergenceCard({ check, change }: Props) {
  return (
    <Card>
      <h3>Điểm hội tụ</h3>
      <SegmentedControl
        label="Mức quan tâm"
        value={String(check.convergence.interest ?? '')}
        options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
        onChange={(v) => change((c) => ({ ...c, convergence: { ...c.convergence, interest: Number(v) } }))}
      />
      <BlurField
        label="Ghi chú tính khả thi"
        value={check.convergence.feasibility}
        save={(feasibility) => change((c) => ({ ...c, convergence: { ...c.convergence, feasibility } }))}
      />
      <p>Tranh luận còn diễn ra?</p>
      <SegmentedControl
        label="Tranh luận còn diễn ra"
        value={check.convergence.debateAlive ?? ''}
        options={[
          { value: 'yes', label: 'Có' },
          { value: 'unsure', label: 'Chưa rõ' },
          { value: 'no', label: 'Không' },
        ]}
        onChange={(v) =>
          change((c) => ({
            ...c,
            convergence: {
              ...c.convergence,
              debateAlive: v === 'yes' ? 'yes' : v === 'no' ? 'no' : 'unsure',
            },
          }))
        }
      />
    </Card>
  );
}
