import { useEffect, useMemo, useRef, useState } from 'react';
import {
  atomicCsv,
  buildMeasurementTree,
  defaultMeasurementSections,
  estimateMeasurementCalls,
  flattenMeasurementTree,
  isMeasurementBlock,
  latestDecisions,
  measurementJson,
  measurementMarkdown,
  metricsCsv,
  planExtraction,
  protocolCsv,
  reviewedProfile,
  type MeasurementNode,
  type MeasurementRef,
} from '@/core/measurement';
import type { MeasurementPending, MeasurementRun, MeasurementsRecord, Paper } from '@/core/schemas';
import { useLlm } from '@/shared/llm/LlmProvider';
import { emptyCheckpoint, llmMeasurement } from '@/shared/llm/llmMeasurement';
import { describeLlmError } from '@/shared/llm/describeError';
import { BatchBudgetExceededError } from '@/core/batch/runBatch';
import { downloadJson, downloadText } from '@/shared/calibration/download';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { ActionBar, ActionMenu } from '@/shared/ui/ActionBar';
import { Card } from '@/shared/ui/Card';
import { TextField } from '@/shared/ui/TextField';
import { Tree, type TreeNode } from '@/shared/ui/Tree';
import type { Decide, ItemContext, Location } from './MeasurementItems';
import { MeasurementDetail } from './MeasurementViews';
import { usePaperScope, useRunBudget } from './paperScope';
import { RunSetup } from './RunSetup';
import styles from './measurement.module.css';
import { Loading } from '@/shared/ui/StateNote';

const CSV = 'text/csv;charset=utf-8';
const sameRef = (a: MeasurementRef, b: MeasurementRef) =>
  a.kind === b.kind && ('id' in a ? a.id : null) === ('id' in b ? b.id : null);

export function PaperMeasurement({
  paper,
  onLocation,
}: {
  paper: Paper;
  onLocation: (location: Location) => void;
}) {
  const repo = useRepositories();
  const llm = useLlm();
  const [record, setRecord] = useState<MeasurementsRecord>();
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = usePaperScope(paper, defaultMeasurementSections);
  const estimate = estimateMeasurementCalls(planExtraction(paper, sections));
  const { budget, setBudget } = useRunBudget(estimate);
  // A resumed run gets a fresh allowance on top of the calls it already made.
  const [cap, setCap] = useState(0);
  const [used, setUsed] = useState(0);
  const [progress, setProgress] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [selectedNode, setSelectedNode] = useState('overview');
  const [query, setQuery] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void repo.measurements
      .get(paper.id)
      .then((value) => {
        if (!active) return;
        setRecord(value);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(String(cause));
        setLoading(false);
      });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [paper.id, repo]);

  async function start(resume: MeasurementPending | null) {
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setError('');
    setProgress('');
    const sectionIds = resume?.sectionIds ?? sections;
    let callsUsed = resume?.callsUsed ?? 0;
    const checkpoint = resume?.checkpoint ?? emptyCheckpoint();
    setUsed(callsUsed);
    setCap(callsUsed + budget);
    try {
      if (!(await llm.ensureConsent('paper')) || abort.signal.aborted) return;
      const result = await llmMeasurement(llm.client, paper, {
        sectionIds,
        config: llm.config,
        budget: (resume?.callsUsed ?? 0) + budget,
        callsUsed,
        checkpoint,
        signal: abort.signal,
        onRequest: async (count) => {
          callsUsed = count;
          setUsed(count);
          await repo.measurements.savePending(paper.id, { sectionIds, callsUsed, checkpoint });
        },
        onUnit: (done, total) => setProgress(`Đã xử lý ${done}/${total} phần`),
        onCheckpoint: async (checkpoint) => {
          await repo.measurements.savePending(paper.id, { sectionIds, callsUsed, checkpoint });
        },
      });
      if (abort.signal.aborted) return;
      let saved = await repo.measurements.saveRun(paper.id, {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        callsUsed: result.callsUsed,
        sectionIds,
        profile: result.profile,
      });
      if (result.profile.status === 'partial')
        saved = await repo.measurements.savePending(paper.id, {
          sectionIds,
          callsUsed: result.callsUsed,
          checkpoint: result.checkpoint,
        });
      setRecord(saved);
      setSelectedNode('overview');
      setShowSetup(false);
    } catch (cause) {
      setRecord(await repo.measurements.get(paper.id));
      if (!abort.signal.aborted)
        setError(
          cause instanceof BatchBudgetExceededError
            ? 'Đã chạm trần số lượt gọi. Phần đã xong được giữ lại; bấm Tiếp tục để chạy phần còn lại.'
            : (describeLlmError(cause) ?? ''),
        );
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setRunning(false);
      }
    }
  }

  const run = record?.runs.at(-1);
  const profile = useMemo(
    () =>
      run && record
        ? reviewedProfile(run.profile, record.decisions, run.id, { keepRejected: true })
        : undefined,
    [run, record],
  );
  const decide: Decide = (input) => {
    if (!run) return;
    void repo.measurements
      .decide(paper.id, { ...input, run_id: run.id, note: null })
      .then(setRecord)
      .catch((cause: unknown) => setError(String(cause)));
  };
  const context: ItemContext | undefined =
    run && record && profile
      ? {
          evidence: new Map(profile.evidence.map((item) => [item.id, item])),
          decisions: new Map(
            latestDecisions(record.decisions, run.id).map((item) => [
              `${item.item_id}|${item.field ?? ''}`,
              item,
            ]),
          ),
          onLocation,
          decide,
        }
      : undefined;

  const exportName = `measurement-${paper.id.slice(0, 8)}`;
  const exported = (current: MeasurementRun) =>
    reviewedProfile(current.profile, record?.decisions ?? [], current.id);
  if (loading) return <Loading label="Đang tải hồ sơ đo lường…" />;
  const pending = record?.pending ?? null;
  const setup = (
    <RunSetup
      paper={paper}
      sections={sections}
      onSections={setSections}
      estimate={estimate}
      budget={budget}
      onBudget={setBudget}
      running={running}
      disabled={!sections.length}
      onStart={() => void start(null)}
      count={(section) =>
        paper.paragraphs.filter((p) => p.sectionId === section.id && isMeasurementBlock(p)).length
      }
    />
  );
  const nodes = profile ? buildMeasurementTree(profile) : [];
  const flat = flattenMeasurementTree(nodes);
  const selected = flat.find((node) => node.id === selectedNode) ?? flat[0];
  const open = (ref: MeasurementRef) => {
    const node = flat.find((item) => sameRef(item.ref, ref));
    if (node) setSelectedNode(node.id);
  };
  const toTree = (node: MeasurementNode): TreeNode => ({
    id: node.id,
    label: node.flagged ? `⚑ ${node.label}` : node.label,
    meta: node.count || undefined,
    children: node.children?.map(toTree),
  });
  const term = query.trim().toLowerCase();
  const treeNodes = term
    ? flat
        .filter((node) => node.label.toLowerCase().includes(term))
        .filter((node, index, list) => list.findIndex((item) => sameRef(item.ref, node.ref)) === index)
        .map((node) => ({ id: node.id, label: node.label, meta: node.count || undefined }))
    : nodes.map(toTree);
  return (
    <div className={styles.panel}>
      <Card padding="md">
        {!run && <h2>Phân tích đo lường và đánh giá</h2>}
        {!run && (
          <p>
            Trích xuất bài báo đã đo gì, bằng metric nào, dưới protocol nào. Mọi thông tin được đối chiếu lại
            với bài bằng code; bạn là người quyết định cuối.
          </p>
        )}
        <ActionBar
          status={
            running || used > 0 ? (
              <span role="status">
                {used}/{cap || budget} lượt {progress && `· ${progress}`}
              </span>
            ) : run ? (
              `Phân tích lúc ${new Date(run.createdAt).toLocaleString('vi-VN')} · ${run.callsUsed} lượt gọi`
            ) : (
              'Chưa phân tích bài này.'
            )
          }
        >
          {running ? (
            <Button variant="danger" onClick={() => controller.current?.abort()}>
              Dừng
            </Button>
          ) : (
            <>
              {run && (
                <ActionMenu
                  label="Xuất"
                  items={[
                    {
                      label: 'JSON',
                      onSelect: () =>
                        downloadJson(`${exportName}.json`, measurementJson(run, record?.decisions ?? [])),
                    },
                    {
                      label: 'Markdown',
                      onSelect: () =>
                        downloadText(
                          `${exportName}.md`,
                          measurementMarkdown(exported(run)),
                          'text/markdown;charset=utf-8',
                        ),
                    },
                    {
                      label: 'CSV metric',
                      onSelect: () =>
                        downloadText(`${exportName}-metrics.csv`, `\uFEFF${metricsCsv(exported(run))}`, CSV),
                    },
                    {
                      label: 'CSV protocol',
                      onSelect: () =>
                        downloadText(
                          `${exportName}-protocol.csv`,
                          `\uFEFF${protocolCsv(exported(run))}`,
                          CSV,
                        ),
                    },
                    {
                      label: 'CSV câu nguyên tử',
                      onSelect: () =>
                        downloadText(`${exportName}-atomic.csv`, `\uFEFF${atomicCsv(exported(run))}`, CSV),
                    },
                  ]}
                />
              )}
              {run && (
                <Button onClick={() => setShowSetup(!showSetup)}>
                  {showSetup ? 'Ẩn thiết lập' : 'Phân tích lại'}
                </Button>
              )}
              {pending && (
                <Button variant="primary" onClick={() => void start(pending)}>
                  Tiếp tục phần còn lại ({Object.keys(pending.checkpoint.units).length} phần đã xong)
                </Button>
              )}
            </>
          )}
        </ActionBar>
        {(!run || showSetup) && !running && setup}
        {error && <div role="alert">{error}</div>}
      </Card>
      {profile && context && selected && (
        <div className={styles.workspace}>
          <div className={styles.nav}>
            <Card padding="md">
              <TextField
                label="Tìm trong hồ sơ"
                size="sm"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {treeNodes.length ? (
                <Tree
                  label="Hồ sơ đo lường"
                  nodes={treeNodes}
                  selectedId={selected.id}
                  onSelect={setSelectedNode}
                />
              ) : (
                <p>Không có mục nào khớp.</p>
              )}
            </Card>
          </div>
          <div className={styles.detail}>
            <MeasurementDetail
              target={selected.ref}
              paper={paper}
              profile={profile}
              context={{
                ...context,
                atomics: new Map(profile.atomic_sentences.map((item) => [item.id, item])),
                openAtomic: (id) => open({ kind: 'atomic', id }),
              }}
              open={open}
            />
          </div>
        </div>
      )}
    </div>
  );
}
