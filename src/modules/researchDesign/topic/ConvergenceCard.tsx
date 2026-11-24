import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import type { Props } from './types';
export function ConvergenceCard({ check, change }: Props) {
  return (
    <div className="topic-quick-choice-grid">
      <SegmentedControl
        label="Mức quan tâm"
        showLabel
        value={String(check.convergence.interest ?? '')}
        options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
        onChange={(v) => change((c) => ({ ...c, convergence: { ...c.convergence, interest: Number(v) } }))}
      />
      <SegmentedControl
        label="Tranh luận còn diễn ra?"
        showLabel
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
    </div>
  );
}
