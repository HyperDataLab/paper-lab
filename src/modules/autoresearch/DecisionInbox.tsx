import type { Stage } from '@/core/autoresearch/contracts';
import type { Run } from '@/core/autoresearch/record';
import type { ResearchDesign } from '@/core/schemas/researchDesign';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { stageLabels } from './labels';
import styles from './autoresearch.module.css';

export function DecisionInbox({
  run,
  charter,
  review,
  lock,
  deviation,
}: {
  run: Run;
  charter: () => void;
  review: (stage: Stage) => void;
  lock?: () => void;
  deviation?: ResearchDesign['planDeviation'];
}) {
  const pending = run.pipeline.filter((row) => row.state === 'gate');
  const deviations = run.decisions.filter((entry) => entry.action === 'deviation');
  return (
    <section aria-labelledby="ar-inbox">
      <h3 id="ar-inbox">Quyết định cần bạn duyệt</h3>
      {!lock && (run.status === 'ended' || (run.charter && pending.length === 0)) ? (
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
          {lock && (
            <li>
              <Button variant="ghost" onClick={lock}>
                {deviation
                  ? `Duyệt thay đổi so với phiên bản ${deviation.planVersion}`
                  : 'Đóng băng kế hoạch'}
              </Button>{' '}
              <Badge>Đã ghim</Badge>
            </li>
          )}
        </ul>
      )}
      {deviations.length > 0 && (
        <details>
          <summary>Thay đổi kế hoạch đã duyệt</summary>
          <ul>
            {deviations.map((entry) => (
              <li key={entry.at}>{entry.note}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
