import { contentOf, currentArtifact, selectedContent } from '@/core/autoresearch/artifacts';
import type { Stage } from '@/core/autoresearch/contracts';
import type { Run } from '@/core/autoresearch/record';
import { TOPIC_RUBRIC_VERSION } from '@/core/autoresearch/validation';
import { downloadJson } from '@/shared/calibration/download';
import { LabKgActions } from '@/shared/labKg/LabKgActions';
import { labKgIds } from '@/shared/labKg/client';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { ArgumentGraph } from './ArgumentGraph';
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
  const collection = stage === 'S4' ? contentOf('S4', artifact) : null;
  const ingest = collection && artifact.status !== 'stale' ? labKgIds(collection.candidates) : [];
  const map = stage === 'S9' ? contentOf('S9', artifact) : null;
  const provenance = (
    <details>
      <summary>Nguồn và phiên bản</summary>
      <pre>{JSON.stringify(artifact, null, 2)}</pre>
    </details>
  );
  if (collection && !collection.candidates.length) return provenance;
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
      {ingest.length > 0 && (
        <LabKgActions
          key={artifact.hash}
          ids={ingest}
          label="Đưa các bài này vào KG của lab"
          showStatus={false}
        />
      )}
      {map ? (
        <>
          <ArgumentGraph key={artifact.hash} graph={map.graph} />
          {artifact.status === 'accepted' && (
            <Button
              variant="secondary"
              onClick={() =>
                downloadJson(`argument-map-${run.id}.json`, {
                  schemaVersion: artifact.schemaVersion,
                  projectId: run.projectId,
                  runId: run.id,
                  hash: artifact.hash,
                  inputHashes: artifact.inputHashes,
                  ...map,
                })
              }
            >
              Tải Argument map (JSON)
            </Button>
          )}
          <details>
            <summary>Xem Claim và Evidence</summary>
            <ArtifactFields
              value={{ claims: map.claims, evidence_links: map.evidence_links, rationales: map.rationales }}
              references={references}
            />
          </details>
        </>
      ) : (
        <ArtifactFields
          value={artifact.status === 'accepted' ? selectedContent(stage, artifact) : artifact.content}
          references={references}
        />
      )}
      {provenance}
    </Card>
  );
}
