import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { BlurField } from './BlurField';
import type { Props } from './types';
export function DecisionCard({ check, change }: Props) {
  return (
    <section className="topic-decision">
      <SegmentedControl
        label="Quyết định"
        showLabel
        value={check.decision.verdict ?? ''}
        options={[
          { value: 'go', label: 'Tiếp tục' },
          { value: 'adjust', label: 'Điều chỉnh' },
          { value: 'groundwork', label: 'Tìm hiểu thêm' },
        ]}
        onChange={(v) =>
          change((c) => ({
            ...c,
            decision: {
              ...c.decision,
              verdict: v === 'go' ? 'go' : v === 'adjust' ? 'adjust' : 'groundwork',
              decidedAt: new Date().toISOString(),
            },
          }))
        }
      />
      <div className="topic-decision-fields">
        <BlurField
          id="topic-decision-note"
          label="Ghi chú quyết định"
          value={check.decision.note}
          rows={2}
          save={(note) => change((c) => ({ ...c, decision: { ...c.decision, note } }))}
        />
        <BlurField
          id="topic-next-step"
          label="Bước tiếp theo"
          placeholder="Ví dụ: trao đổi với người hướng dẫn"
          value={check.decision.nextHumanStep}
          rows={2}
          save={(nextHumanStep) => change((c) => ({ ...c, decision: { ...c.decision, nextHumanStep } }))}
        />
      </div>
    </section>
  );
}
