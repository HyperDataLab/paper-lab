import { Card } from '@/shared/ui/Card';
import { BlurField } from './BlurField';
import type { Props } from './types';
export function PlainSummaryCard({ check, change }: Props) {
  return (
    <Card>
      <h3>Giải thích dễ hiểu</h3>
      <BlurField
        label="Tóm tắt cho người không chuyên"
        value={check.plainSummary}
        save={(plainSummary) => change((c) => ({ ...c, plainSummary }))}
      />
    </Card>
  );
}
