import { PROMPT_VERSIONS } from '@/core/prompts';
import { runFreshness } from '@/core/runFreshness';
import { useStoredChanged } from './paperJobs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { insightStates } from '@/core/rhetoric';
import type { Finding, Paper, PaperInsightsRecord, SnapshotField } from '@/core/schemas';
import { describeLlmError } from '@/shared/llm/describeError';
import { useLlm } from '@/shared/llm/LlmProvider';
import { llmSnapshot } from '@/shared/llm/llmSnapshot';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { ActionBar } from '@/shared/ui/ActionBar';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { ReviewActions } from '@/shared/ui/FindingCard';
import { useReportJob } from './paperJobs';
import styles from './snapshot.module.css';
import { PlaceText } from './PlaceText';

const LABELS: Record<SnapshotField, string> = {
  methods: 'Methods',
  outcome: 'Outcome',
  results: 'Results',
  population: 'Population',
  sample_size: 'Sample size',
  duration: 'Duration',
  location: 'Location',
};

export function PaperSnapshot({
  paper,
  onLocation,
  compact = false,
}: {
  paper: Paper;
  onLocation: (location: Finding['locations'][number]) => void;
  /** The facts alone, as a strip above the summary; the summary's button makes them. */
  compact?: boolean;
}) {
  const repo = useRepositories();
  const notifyStoredChanged = useStoredChanged();
  const llm = useLlm();
  const [record, setRecord] = useState<PaperInsightsRecord>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void repo.paperInsights.get(paper.id).then((value) => {
      if (!active) return;
      setRecord(value);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [paper.id, repo]);
  const run = record?.snapshotRuns.at(-1);
  const states = useMemo(
    () => (run && record ? insightStates(run, record.decisions) : new Map()),
    [run, record],
  );
  async function start() {
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setError('');
    try {
      if (!(await llm.ensureConsent('paper'))) return 'declined';
      if (abort.signal.aborted) return;
      const result = await llmSnapshot(llm.client, paper, { config: llm.config, signal: abort.signal });
      setRecord(await repo.paperInsights.saveSnapshotRun(paper.id, result));
      notifyStoredChanged();
    } catch (cause) {
      if (!abort.signal.aborted) setError(describeLlmError(cause) ?? 'Không tạo được snapshot.');
    } finally {
      setRunning(false);
    }
  }
  const decide = (id: string, decision: 'confirm' | 'dismiss' | 'reopen') => {
    if (!run) return;
    void repo.paperInsights
      .decide(paper.id, { run_id: run.id, item_id: id, decision })
      .then((value) => {
        setRecord(value);
        notifyStoredChanged();
      })
      .catch((cause: unknown) => setError(String(cause)));
  };
  useReportJob('snapshot', {
    stale: run
      ? runFreshness(
          { sectionIds: run.sectionIds, promptVersions: { main: run.promptVersion }, model: run.model },
          { promptVersions: { main: PROMPT_VERSIONS.snapshot }, model: llm.config.model },
        )
      : null,
    running,
    done: Boolean(run),
    estimate: 1,
    ready: loaded,
    start,
    stop: () => controller.current?.abort(),
  });
  if (compact) {
    // A rejected fact stays in place, dimmed, so the decision can be undone.
    const shown = (run?.values ?? []).filter((item) => item.status === 'reported');
    if (running && !run) return <p role="status">Đang trích Key facts…</p>;
    if (shown.length === 0) return error ? <p role="alert">{error}</p> : null;
    return (
      <section className={styles.strip} aria-label="Key facts">
        <dl>
          {shown.map((item) => (
            <div key={item.id} className={styles.fact} data-rejected={states.get(item.id) === 'dismissed'}>
              <dt>{LABELS[item.field]}</dt>
              <dd>
                <span>{item.value}</span>
                {item.source && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className={styles.page}
                    title={item.source.excerpt}
                    onClick={() =>
                      item.source &&
                      onLocation({
                        paragraphId: item.source.paragraphId,
                        start: item.source.start,
                        end: item.source.end,
                      })
                    }
                  >
                    {item.source.page ? `Tr. ${item.source.page}` : 'Câu gốc'}
                  </Button>
                )}
                {states.get(item.id) === 'dismissed' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className={styles.page}
                    onClick={() => decide(item.id, 'reopen')}
                  >
                    Hoàn tác
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className={styles.page}
                    aria-label={`Bác bỏ ${LABELS[item.field]}`}
                    title="Bác bỏ giá trị này"
                    onClick={() => decide(item.id, 'dismiss')}
                  >
                    ×
                  </Button>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  return (
    <Card>
      <h2>Snapshot</h2>
      <ActionBar
        status={
          running ? (
            <span role="status">Đang đọc bài…</span>
          ) : run ? (
            `Tạo lúc ${new Date(run.createdAt).toLocaleString('vi-VN')} · ${run.callsUsed} lượt gọi`
          ) : (
            'Ước tính 1 lượt gọi AI. AI đọc Tóm tắt, Phương pháp và Kết quả.'
          )
        }
      >
        <Button variant="primary" disabled={running} onClick={() => void start()}>
          {run ? 'Tạo lại' : 'Tạo snapshot (AI)'}
        </Button>
      </ActionBar>
      {error && <p role="alert">{error}</p>}
      {run && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Thuộc tính</th>
              <th scope="col">Giá trị</th>
              <th scope="col">Nguồn</th>
            </tr>
          </thead>
          <tbody>
            {run.values.map((item) => {
              const state = states.get(item.id);
              return (
                <tr key={item.id} className={state === 'dismissed' ? styles.dismissed : undefined}>
                  <th scope="row">{LABELS[item.field]}</th>
                  <td>
                    {item.status === 'reported' ? (
                      <>
                        <p className={styles.value}>{item.value}</p>
                        {state && (
                          <Badge tone={state === 'confirmed' ? 'success' : 'danger'}>
                            {state === 'confirmed' ? 'Đã xác nhận' : 'Đã bác bỏ'}
                          </Badge>
                        )}
                      </>
                    ) : (
                      <span className={styles.missing}>
                        {item.status === 'unverified' ? 'Chưa kiểm chứng được trong bài' : 'Chưa thấy nêu'}
                      </span>
                    )}
                  </td>
                  <td>
                    {item.source && (
                      <div className={styles.source}>
                        <q>{item.source.excerpt}</q>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            item.source &&
                            onLocation({
                              paragraphId: item.source.paragraphId,
                              start: item.source.start,
                              end: item.source.end,
                            })
                          }
                        >
                          <PlaceText paper={paper} paragraphId={item.source.paragraphId} />
                        </Button>
                        <ReviewActions
                          acceptByDefault
                          decided={Boolean(state)}
                          dismissLabel="Loại bỏ"
                          onConfirm={() => decide(item.id, 'confirm')}
                          onDismiss={() => decide(item.id, 'dismiss')}
                          onUndo={() => decide(item.id, 'reopen')}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {run && (
        <p className={styles.note}>
          Giá trị chỉ hiện khi có câu trích tìm thấy trong bài, và mọi con số phải có trong câu trích đó. Chưa
          qua hiệu chuẩn.
        </p>
      )}
    </Card>
  );
}
