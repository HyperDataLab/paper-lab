import { acceptedInputs, currentArtifact } from '@/core/autoresearch/artifacts';
import type { Stage } from '@/core/autoresearch/contracts';
import type { Run } from '@/core/autoresearch/record';
import { stageState } from '@/core/autoresearch/run';
import { SCREENING_BATCH } from '@/core/extraction';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { stageLabels } from './labels';
import styles from './autoresearch.module.css';

function estimateCalls(run: Run, stage: Stage) {
  const state = stageState(run, stage);
  const resuming = state.state === 'working';
  const supervisors = resuming ? Number(!state.critic) + Number(!state.pi) : 2;
  if (stage === 'S4' || (resuming && (currentArtifact(run, stage) || state.error))) return supervisors;
  const inputs = acceptedInputs(run, stage);
  if (stage === 'S5') {
    const completed = new Set(resuming ? state.screeningProgress.map((d) => d.paperId) : []);
    const awaiting = inputs.S4?.candidates.filter((p) => !p.existingDecision && !completed.has(p.id)) ?? [];
    return supervisors + Math.ceil(awaiting.length / SCREENING_BATCH);
  }
  if (stage === 'S6') {
    const eligible = new Set(inputs.S4?.candidates.filter((p) => p.abstract || p.doi).map((p) => p.id));
    const included =
      inputs.S5?.decisions.filter((d) => d.decision === 'included' && eligible.has(d.paperId)) ?? [];
    return supervisors + Math.max(0, included.length - (resuming ? state.cardCursor : 0));
  }
  return supervisors + 1;
}

export function LaunchStageDialog({
  run,
  stage,
  busy,
  close,
  start,
}: {
  run: Run;
  stage: Stage;
  busy: boolean;
  close: () => void;
  start: () => void;
}) {
  return (
    <Dialog
      title={`Chi phí dự kiến · ${stageLabels[stage]}`}
      description="Ước tính lượt gọi trước khi bắt đầu stage."
      onClose={close}
    >
      <p>
        {stage === 'S6' ? 'Tối đa' : 'Dự kiến'} {estimateCalls(run, stage)} lượt gọi AI nếu không cần tra cứu,
        sửa JSON hoặc thử lại. Số tiền chưa xác định.
      </p>
      <p>Run còn {run.budget.maxCalls - run.budget.calls} lượt gọi trong giới hạn.</p>
      {stageState(run, stage).state === 'accepted' && (
        <p>Chạy lại sẽ đánh dấu kết quả từ stage này trở đi là đã cũ.</p>
      )}
      <div className={styles.actions}>
        <Button variant="ghost" onClick={close}>
          Huỷ
        </Button>
        <Button variant="primary" disabled={busy} onClick={start}>
          Bắt đầu
        </Button>
      </div>
    </Dialog>
  );
}
