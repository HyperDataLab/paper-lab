import { useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultMeasurementSections,
  estimateMeasurementCalls,
  latestDecisions,
  planExtraction,
  reviewedProfile,
} from '@/core/measurement';
import type { MeasurementPending, MeasurementsRecord, Paper } from '@/core/schemas';
import { useLlm } from '@/shared/llm/LlmProvider';
import { emptyCheckpoint, llmMeasurement } from '@/shared/llm/llmMeasurement';
import { describeLlmError } from '@/shared/llm/describeError';
import { BatchBudgetExceededError } from '@/core/batch/runBatch';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Checkbox } from '@/shared/ui/Checkbox';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { TextField } from '@/shared/ui/TextField';
import type { Decide, ItemContext, Location } from './MeasurementItems';
import { IssuesView, MetricsView, OverviewView, ProtocolView, ResultsView } from './MeasurementViews';
import styles from './measurement.module.css';

const VIEWS = [
  { value: 'overview', label: 'Tổng quan' },
  { value: 'metrics', label: 'Metric' },
  { value: 'protocol', label: 'Protocol' },
  { value: 'results', label: 'Kết quả & truy vết' },
  { value: 'issues', label: 'Vấn đề & duyệt' },
];

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
  const [sections, setSections] = useState(() => defaultMeasurementSections(paper));
  const estimate = estimateMeasurementCalls(planExtraction(paper, sections));
  const [budget, setBudget] = useState(() => estimate * 2);
  const [used, setUsed] = useState(0);
  const [progress, setProgress] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState('overview');
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
    setUsed(callsUsed);
    try {
      if (!(await llm.ensureConsent('paper')) || abort.signal.aborted) return;
      const result = await llmMeasurement(llm.client, paper, {
        sectionIds,
        config: llm.config,
        budget,
        callsUsed,
        checkpoint: resume?.checkpoint ?? emptyCheckpoint(),
        signal: abort.signal,
        onRequest: async (count) => {
          callsUsed = count;
          setUsed(count);
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
      if (result.failedUnits.length)
        saved = await repo.measurements.savePending(paper.id, {
          sectionIds,
          callsUsed: result.callsUsed,
          checkpoint: result.checkpoint,
        });
      setRecord(saved);
      setView('overview');
    } catch (cause) {
      setRecord(await repo.measurements.get(paper.id));
      if (!abort.signal.aborted)
        setError(
          cause instanceof BatchBudgetExceededError
            ? 'Đã chạm trần số lượt gọi. Phần đã xong được giữ lại; nâng trần rồi bấm Tiếp tục.'
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

  if (loading) return <p>Đang tải hồ sơ đo lường…</p>;
  return (
    <div className={styles.panel}>
      <Card>
        <h2>Phân tích đo lường và đánh giá</h2>
        <p>
          Trích xuất bài báo đã đo gì, bằng metric nào, dưới protocol nào. Mọi thông tin được đối chiếu lại
          với bài bằng code; bạn là người quyết định cuối.
        </p>
        <fieldset disabled={running}>
          <legend>Mục được gửi cho AI</legend>
          {paper.sections.map((section) => (
            <Checkbox
              key={section.id}
              checked={sections.includes(section.id)}
              onChange={(e) =>
                setSections((old) =>
                  e.target.checked ? [...old, section.id] : old.filter((item) => item !== section.id),
                )
              }
            >
              {section.heading}
            </Checkbox>
          ))}
        </fieldset>
        <p>Ước tính {estimate} lượt gọi AI (chưa tính thử lại).</p>
        <TextField
          label="Trần số lượt gọi"
          type="number"
          min={1}
          value={String(budget)}
          disabled={running}
          onChange={(e) => setBudget(Number(e.target.value))}
        />
        <div className={styles.meta}>
          {running ? (
            <Button variant="danger" onClick={() => controller.current?.abort()}>
              Dừng
            </Button>
          ) : (
            <>
              <Button variant="primary" disabled={!sections.length} onClick={() => void start(null)}>
                {run ? 'Phân tích lại' : 'Bắt đầu phân tích'}
              </Button>
              {record?.pending && (
                <Button onClick={() => void start(record.pending)}>
                  Tiếp tục phần còn lại ({Object.keys(record.pending.checkpoint.units).length} phần đã xong)
                </Button>
              )}
            </>
          )}
          {(running || used > 0) && (
            <span role="status">
              {used}/{budget} lượt {progress && `· ${progress}`}
            </span>
          )}
        </div>
        {error && <div role="alert">{error}</div>}
      </Card>
      {profile && context && run && (
        <>
          <SegmentedControl label="Xem hồ sơ" value={view} options={VIEWS} onChange={setView} />
          {view === 'overview' && <OverviewView profile={profile} paper={paper} />}
          {view === 'metrics' && <MetricsView profile={profile} context={context} />}
          {view === 'protocol' && <ProtocolView profile={profile} context={context} />}
          {view === 'results' && <ResultsView profile={profile} context={context} />}
          {view === 'issues' && <IssuesView profile={profile} context={context} />}
        </>
      )}
    </div>
  );
}
