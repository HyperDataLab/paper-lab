import { Card } from '@/shared/ui/Card';
import { BlurField } from './BlurField';
import type { Props } from './types';
export function DebateCard({ check, change }: Props) {
  return (
    <Card>
      <h3>Tranh luận</h3>
      <BlurField
        label="Tranh luận đang diễn ra"
        value={check.debate}
        save={(debate) => change((c) => ({ ...c, debate }))}
      />
    </Card>
  );
}
