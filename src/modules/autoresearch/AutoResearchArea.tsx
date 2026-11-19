import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { contentOf, currentArtifact, selectable } from '@/core/autoresearch/artifacts';
import { STAGES, stageSchema, type Stage } from '@/core/autoresearch/contracts';
import {
  approveCharter,
  canContinueLegacyRun,
  checkObligation,
  continueLegacyRun,
  decideGate,
  endRun,
  nextStage,
  stageState,
} from '@/core/autoresearch/run';
import type { ExtractionProject } from '@/core/schemas';
import { useResearchDesign } from '@/modules/researchDesign';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Empty, Loading } from '@/shared/ui/StateNote';
import { ArtifactFields } from './ArtifactFields';
import { ArtifactEditor } from './ArtifactEditor';
import { ArtifactViewer } from './ArtifactViewer';
import { CharterForm } from './CharterForm';
import { CopyHypothesesAction } from './CopyHypothesesAction';
import { CriticPanel } from './CriticPanel';
import { DecisionInbox } from './DecisionInbox';
import { ExperimentStageActions } from './ExperimentStageActions';
import { experimentStageState } from './experimentStageState';
import { GateSheet } from './GateSheet';
import { LaunchStageDialog } from './LaunchStageDialog';
import { NotebookPanel } from './NotebookPanel';
import { ObligationsPanel } from './ObligationsPanel';
import { PiPanel } from './PiPanel';
import { RunHeader } from './RunHeader';
import { StageTrack } from './StageTrack';
import { stageErrors, stageLabels } from './labels';
import { useAutoResearch } from './useAutoResearch';
import styles from './autoresearch.module.css';

export function AutoResearchArea({ project }: { project: ExtractionProject }) {
  const design = useResearchDesign();
  const [params, setParams] = useSearchParams();
  const researchDesign = design.loading || design.error ? null : design.design;
  const auto = useAutoResearch(
    project,
    design.loading || design.error ? null : design.bank,
    params.get('arRun') ?? undefined,
  );
  const [editCharter, setEditCharter] = useState(false);
  const [editStage, setEditStage] = useState<Stage | null>(null);
  const [gate, setGate] = useState<Stage | null>(null);
  const [estimate, setEstimate] = useState(false);
  const stage = stageSchema.catch('S1').parse(params.get('ar'));
  const select = (next: Stage) => {
    const query = new URLSearchParams(params);
    query.set('ar', next);
    setParams(query);
  };
  const { run, runs, busy, error } = auto;
  if (error && !runs)
    return (
      <Empty title="Không tải được AutoResearch.">
        <Button onClick={auto.retryLoad}>Thử lại</Button>
        <details>
          <summary>Chi tiết kỹ thuật</summary>
          {error}
        </details>
      </Empty>
    );
  if (!runs) return <Loading label="Đang tải AutoResearch…" />;
  if (!run)
    return (
      <section>
        <h2>AutoResearch</h2>
        <Empty title="Project chưa có run AutoResearch.">
          <Button variant="primary" disabled={busy} onClick={() => void auto.create()}>
            Tạo run
          </Button>
          {error && <p role="alert">Không thể tạo run.</p>}
        </Empty>
      </section>
    );
  const state = stageState(run, stage);
  const active = run.pipeline.find((row) => row.state === 'working');
  const artifact = currentArtifact(run, stage);
  const experiment = experimentStageState(run, researchDesign);
  const rejection =
    stage === 'S1' && state.error === 'INVALID_GOAL' && artifact
      ? contentOf('S1', artifact).goal.rejectionReason
      : null;
  const canRun =
    run.charter &&
    stage !== 'S11' &&
    (stage !== 'S12' || experiment.log) &&
    run.status !== 'ended' &&
    state.state !== 'gate' &&
    (!active || active.stage === stage) &&
    STAGES.slice(0, STAGES.indexOf(stage)).every((earlier) => stageState(run, earlier).state === 'accepted');
  const names = new Map(selectable(artifact).map((item) => [item.id, item.label]));
  const gateArtifact = gate ? currentArtifact(run, gate) : undefined;
  const editTarget = editStage ? currentArtifact(run, editStage) : undefined;
  const collection = currentArtifact(run, 'S4');
  const paperTitles = new Map(
    collection ? contentOf('S4', collection).candidates.map((p) => [p.id, p.title]) : [],
  );
  const screeningNames =
    gate === 'S5' && gateArtifact
      ? new Map(
          contentOf('S5', gateArtifact).decisions.map((d) => [d.id, paperTitles.get(d.paperId) ?? d.reason]),
        )
      : undefined;
  return (
    <section aria-labelledby="ar-title" className={styles.stack}>
      <RunHeader
        run={run}
        runs={runs}
        busy={busy}
        sharedModel={auto.usingSharedModel}
        selectRun={auto.selectRun}
        create={() => {
          select('S1');
          void auto.create();
        }}
      />
      <StageTrack run={run} stage={stage} select={select} />
      <DecisionInbox
        run={run}
        lock={experiment.pendingLock ? () => select('S11') : undefined}
        deviation={experiment.deviation}
        charter={() => setEditCharter(true)}
        review={(next) => {
          select(next);
          setGate(next);
        }}
      />
      {canContinueLegacyRun(run) && (
        <Button
          disabled={busy}
          onClick={() => {
            const following = nextStage(run);
            void auto.change(continueLegacyRun).then((saved) => {
              if (saved && following) select(following.stage);
            });
          }}
        >
          Tiếp tục run
        </Button>
      )}
      {error && !gate && !editStage && (
        <div role="alert">
          <p>Không thể hoàn tất thao tác AutoResearch.</p>
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            {error}
          </details>
        </div>
      )}
      <section className={styles.stack} aria-label="Charter">
        <h3>
          Charter <Badge>Đã ghim</Badge>
        </h3>
        {editCharter && run.status === 'waiting' ? (
          <CharterForm
            key={run.id}
            current={run.charter}
            question={project.researchQuestion}
            hasResults={run.artifacts.length > 0}
            cancel={() => setEditCharter(false)}
            submit={(charter, note) => {
              void auto
                .change((record, at) => approveCharter(record, charter, at, note))
                .then((saved) => {
                  if (saved) setEditCharter(false);
                });
            }}
          />
        ) : (
          <>
            {run.charter && (
              <details open={stage === 'S1'}>
                <summary>Xem charter đã duyệt</summary>
                <ArtifactFields value={run.charter} />
              </details>
            )}
            {run.charter && run.status === 'waiting' && (
              <Button variant="ghost" onClick={() => setEditCharter(true)}>
                Sửa charter
              </Button>
            )}
          </>
        )}
      </section>
      <section className={styles.stack} aria-label={stageLabels[stage]}>
        <h3>
          {stage} · {stageLabels[stage]}
        </h3>
        <div className={styles.actions}>
          {canRun && !busy && run.budget.calls < run.budget.maxCalls && (
            <Button variant="primary" onClick={() => setEstimate(true)}>
              {state.state === 'working'
                ? 'Tiếp tục stage'
                : state.state === 'accepted' || state.attempt
                  ? 'Chạy lại stage'
                  : 'Chạy stage'}
            </Button>
          )}
          {state.state === 'gate' && run.status === 'waiting' && (
            <Button variant="primary" onClick={() => setGate(stage)}>
              Mở phiếu duyệt
            </Button>
          )}
          {artifact &&
            !['S4', 'S10', 'S11', 'S12'].includes(stage) &&
            !busy &&
            run.status === 'waiting' &&
            (state.state === 'accepted' || (state.state === 'gate' && !state.error)) && (
              <Button variant="ghost" onClick={() => setEditStage(stage)}>
                Sửa kết quả
              </Button>
            )}
          {run.status !== 'ended' && (run.status === 'running' || !busy) && (
            <Button variant="danger" onClick={() => void auto.stop()}>
              {run.status === 'running' ? 'Dừng' : 'Huỷ run'}
            </Button>
          )}
          {!busy && run.status === 'waiting' && (run.budget.calls >= run.budget.maxCalls || state.error) && (
            <Button
              variant="ghost"
              onClick={() => void auto.change((record, at) => endRun(record, 'failed', at))}
            >
              Kết thúc vì lỗi
            </Button>
          )}
        </div>
        <p role="status">
          {run.status === 'running' && active ? `Đang thực hiện ${stageLabels[active.stage]} · ` : ''}
          {run.budget.calls}/{run.budget.maxCalls} lượt gọi AI
        </p>
        {run.budget.calls >= run.budget.maxCalls && run.status !== 'ended' && (
          <p>Đã chạm giới hạn lượt gọi của run.</p>
        )}
        {state.error && (
          <div role="alert">
            <p>{stageErrors[state.error]}</p>
            {rejection && <p>{rejection}</p>}
            <details>
              <summary>Chi tiết kỹ thuật</summary>
              {state.error}
            </details>
          </div>
        )}
        {state.reviewError && (
          <div role="alert">
            <p>Chưa hoàn tất phần đánh giá của PI hoặc Critic.</p>
            <details>
              <summary>Chi tiết kỹ thuật</summary>
              {state.reviewError}
            </details>
          </div>
        )}
        {state.models?.sharedModel && run.endReason && <p>PI và Critic đã dùng chung model cho stage này.</p>}
        {(!state.error ||
          state.error === 'TOPIC_BELOW_THRESHOLD' ||
          state.error === 'EMPTY_SHORTLIST' ||
          state.error === 'NO_LITERATURE') && (
          <ArtifactViewer run={run} stage={stage} publishedAt={experiment.publishedAt} />
        )}
        {stage === 'S8' && <CopyHypothesesAction key={run.id} run={run} />}
        <ExperimentStageActions
          key={`${run.id}:${stage}`}
          run={run}
          stage={stage}
          state={experiment}
          busy={busy}
          connect={auto.connectLock}
          save={auto.importResults}
        />
        {state.pi && <PiPanel decision={state.pi} names={names} />}
        {state.critic && <CriticPanel report={state.critic} stage={stage} obligations={run.obligations} />}
      </section>
      <ObligationsPanel
        key={`${run.id}:${stage}`}
        run={run}
        stage={stage}
        busy={busy}
        change={(id, status, note) =>
          auto.change((record) => checkObligation(record, id, status, stage, note))
        }
      />
      <NotebookPanel
        key={run.id}
        entries={run.notebook}
        disabled={run.status !== 'waiting' || busy}
        add={(text) =>
          auto.change((record, at) => ({
            ...record,
            notebook: [
              ...record.notebook,
              {
                id: crypto.randomUUID(),
                kind: 'directive',
                author: 'person',
                text,
                at,
              },
            ],
          }))
        }
      />
      {estimate && (
        <LaunchStageDialog
          run={run}
          stage={stage}
          busy={busy}
          close={() => setEstimate(false)}
          start={() => {
            setEstimate(false);
            void auto.start(stage);
          }}
        />
      )}
      {gate && stageState(run, gate).state === 'gate' && (
        <GateSheet
          key={`${run.id}:${gate}:${stageState(run, gate).attempt}`}
          state={stageState(run, gate)}
          artifact={gateArtifact}
          itemLabels={screeningNames}
          busy={busy}
          error={error}
          close={() => setGate(null)}
          decide={(choice) => {
            void auto
              .change((record, at) => decideGate(record, gate, choice, at))
              .then((saved) => {
                if (!saved) return;
                setGate(null);
                const following = STAGES[STAGES.indexOf(gate) + 1];
                if (choice.approve && following && gate !== 'S10') select(following);
              });
          }}
        />
      )}
      {editStage && editTarget && (
        <ArtifactEditor
          key={`${editStage}:${editTarget.attempt}`}
          artifact={editTarget}
          busy={busy}
          error={error}
          close={() => setEditStage(null)}
          save={(value, note) => auto.edit(editStage, value, note)}
        />
      )}
    </section>
  );
}
