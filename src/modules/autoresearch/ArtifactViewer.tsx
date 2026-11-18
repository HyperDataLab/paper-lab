import { contentOf, currentArtifact, selectedContent } from '@/core/autoresearch/artifacts';
import type { Stage } from '@/core/autoresearch/contracts';
import type { Run } from '@/core/autoresearch/record';
import { TOPIC_RUBRIC_VERSION } from '@/core/autoresearch/validation';
import { Badge } from '@/shared/ui/Badge';
import { Card } from '@/shared/ui/Card';
import { ArtifactFields } from './ArtifactFields';
import { referenceLabels } from './referenceLabels';

export function ArtifactViewer({ run, stage }: { run: Run; stage: Stage }) {
  const artifact = currentArtifact(run, stage) ?? run.artifacts.findLast((item) => item.stage === stage);
  if (!artifact) return null;
  const references = referenceLabels(run);
  const hypotheses =
    stage === 'S8' && artifact.status === 'accepted' ? selectedContent('S8', artifact) : null;
  const primary = hypotheses?.hypotheses.find((item) => item.id === artifact.primaryId);
  const scores = stage === 'S2' ? contentOf('S2', artifact).scores : null;
  return (
    <Card>
      <h4>Kết quả stage</h4>
      <Badge tone={artifact.status === 'accepted' ? 'success' : 'warning'}>
        {artifact.status === 'accepted'
          ? 'Đã duyệt'
          : artifact.status === 'stale'
            ? 'Đã cũ'
            : 'Ứng viên cần xem lại'}
      </Badge>
      {scores && (
        <p>
          Điểm heuristic trên thang 0–1 · rubric {TOPIC_RUBRIC_VERSION} ·
          {Object.values(scores).some((score) => score === null)
            ? ' Có tiêu chí chưa xác định'
            : ' Đủ các tiêu chí'}{' '}
          · Độ tin cậy chưa xác định.
        </p>
      )}
      {stage === 'S8' && <p>Đánh giá novelty theo heuristic, trong phạm vi các bài đã đối chiếu.</p>}
      {primary && (
        <p>
          <Badge tone="accent">Primary hypothesis</Badge> {primary.statement}
        </p>
      )}
      <ArtifactFields
        value={artifact.status === 'accepted' ? selectedContent(stage, artifact) : artifact.content}
        references={references}
      />
      <details>
        <summary>Nguồn và phiên bản</summary>
        <pre>{JSON.stringify(artifact, null, 2)}</pre>
      </details>
    </Card>
  );
}
