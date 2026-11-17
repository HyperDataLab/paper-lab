import { Card } from '@/shared/ui/Card';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { BlurField } from './BlurField';
import type { Props } from './types';
export function DecisionCard({ check, change }: Props) {
  return (
    <Card>
      <h3>Quyết định của nhà nghiên cứu</h3>
      <SegmentedControl
        label="Quyết định"
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
      <BlurField
        label="Ghi chú quyết định"
        value={check.decision.note}
        save={(note) => change((c) => ({ ...c, decision: { ...c.decision, note } }))}
      />
      <BlurField
        label="Bước tiếp theo với người khác"
        placeholder="Ví dụ: trao đổi với người hướng dẫn"
        value={check.decision.nextHumanStep}
        save={(nextHumanStep) => change((c) => ({ ...c, decision: { ...c.decision, nextHumanStep } }))}
      />
    </Card>
  );
}
