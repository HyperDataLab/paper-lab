import { Card } from '@/shared/ui/Card';
import { BlurField } from './BlurField';
import type { Props } from './types';
export function StatementCard({ check, change }: Props) {
  return (
    <Card>
      <h3>Đề tài và khoảng trống</h3>
      <BlurField
        label="Phát biểu đề tài"
        value={check.statement}
        save={(statement) => change((c) => ({ ...c, statement }))}
      />
    </Card>
  );
}
