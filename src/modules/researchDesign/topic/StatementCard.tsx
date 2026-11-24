import { BlurField } from './BlurField';
import type { Props } from './types';
export function StatementCard({ check, change }: Props) {
  return (
    <section>
      <BlurField
        id="topic-statement"
        label="Phát biểu đề tài"
        rows={3}
        maxRows={12}
        value={check.statement}
        save={(statement) => change((c) => ({ ...c, statement }))}
      />
    </section>
  );
}
