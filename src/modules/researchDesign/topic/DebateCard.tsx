import { BlurField } from './BlurField';
import type { Props } from './types';
export function DebateCard({ check, change }: Props) {
  return (
    <section>
      <BlurField
        id="topic-debate"
        label="Tranh luận đang diễn ra"
        value={check.debate}
        rows={2}
        save={(debate) => change((c) => ({ ...c, debate }))}
      />
    </section>
  );
}
