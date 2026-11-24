import { BlurField } from './BlurField';
import type { Props } from './types';
export function PlainSummaryCard({ check, change }: Props) {
  return (
    <section>
      <BlurField
        id="topic-summary"
        label="Tóm tắt cho người không chuyên"
        value={check.plainSummary}
        rows={2}
        maxRows={12}
        save={(plainSummary) => change((c) => ({ ...c, plainSummary }))}
      />
    </section>
  );
}
