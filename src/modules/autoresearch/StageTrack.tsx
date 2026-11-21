import type { Stage } from '@/core/autoresearch/contracts';
import type { Run } from '@/core/autoresearch/record';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { stageLabels, stageStates } from './labels';
import styles from './autoresearch.module.css';

export function StageTrack({
  run,
  stage,
  select,
}: {
  run: Run;
  stage: Stage;
  select: (stage: Stage) => void;
}) {
  return (
    <nav aria-label="Tiến độ AutoResearch">
      <ol className={styles.track}>
        {run.pipeline.map((row) => (
          <li key={row.stage}>
            <Button
              size="sm"
              variant={stage === row.stage ? 'secondary' : 'ghost'}
              aria-pressed={stage === row.stage}
              onClick={() => select(row.stage)}
            >
              {row.stage} · {stageLabels[row.stage]}
            </Button>
            {row.state !== 'idle' && (
              <Badge
                tone={
                  row.state === 'stale' || row.state === 'rejected'
                    ? 'warning'
                    : row.state === 'accepted'
                      ? 'success'
                      : 'accent'
                }
              >
                {row.state === 'working' && run.status === 'waiting' ? 'Tạm dừng' : stageStates[row.state]}
              </Badge>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
