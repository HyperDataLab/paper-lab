import { useEffect, useMemo, useState } from 'react';
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
import { placeLabel } from './paperLabels';
import { useReportJob } from './paperJobs';
import styles from './snapshot.module.css';

const LABELS: Record<SnapshotField, string> = {
  methods: 'Phương pháp',
  outcome: 'Biến kết cục',
  results: 'Kết quả',
  population: 'Đối tượng',
  sample_size: 'Cỡ mẫu',
  duration: 'Thời gian',
  location: 'Địa điểm',
};

export function PaperSnapshot({
  paper,
  onLocation,
}: {
  paper: Paper;
  onLocation: (location: Finding['locations'][number]) => void;
}) {
  const repo = useRepositories();
  const llm = useLlm();
  const [record, setRecord] = useState<PaperInsightsRecord>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
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
    setRunning(true);
    setError('');
    try {
      if (!(await llm.ensureConsent('paper'))) return;
      const result = await llmSnapshot(llm.client, paper, { config: llm.config });
      setRecord(await repo.paperInsights.saveSnapshotRun(paper.id, result));
    } catch (cause) {
      setError(describeLlmError(cause) ?? 'Không tạo được snapshot.');
    } finally {
      setRunning(false);
    }
  }
  const decide = (id: string, decision: 'confirm' | 'dismiss' | 'reopen') => {
    if (!run) return;
    void repo.paperInsights
      .decide(paper.id, { run_id: run.id, item_id: id, decision })
      .then(setRecord)
      .catch((cause: unknown) => setError(String(cause)));
  };
  useReportJob('snapshot', { running, done: Boolean(run), estimate: 1, ready: loaded, start });
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
                            {state === 'confirmed' ? 'Đã xác nhận' : 'Đã loại'}
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
                          {placeLabel(paper, item.source.paragraphId)}
                        </Button>
                        <ReviewActions
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
