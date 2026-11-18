import type { Stage } from '@/core/autoresearch/contracts';
import type { Run } from '@/core/autoresearch/record';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { stageLabels } from './labels';
import styles from './autoresearch.module.css';

export function DecisionInbox({
  run,
  charter,
  review,
}: {
  run: Run;
  charter: () => void;
  review: (stage: Stage) => void;
}) {
  const pending = run.pipeline.filter((row) => row.state === 'gate');
  return (
    <section aria-labelledby="ar-inbox">
      <h3 id="ar-inbox">Quyết định cần bạn duyệt</h3>
      {run.status === 'ended' || (run.charter && pending.length === 0) ? (
        <p>Không có quyết định đang chờ.</p>
      ) : (
        <ul className={styles.rows}>
          {!run.charter && (
            <li>
              <Button variant="ghost" onClick={charter}>
                Duyệt charter
              </Button>{' '}
              <Badge>Đã ghim</Badge>
            </li>
          )}
          {pending.map(({ stage }) => (
            <li key={stage}>
              <Button variant="ghost" onClick={() => review(stage)}>
                {stage === 'S8' ? 'Chọn hypotheses và primary hypothesis' : `Duyệt ${stageLabels[stage]}`}
              </Button>
              {stage === 'S8' && <Badge>Đã ghim</Badge>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
