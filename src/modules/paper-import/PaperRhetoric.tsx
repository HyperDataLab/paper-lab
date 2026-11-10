import { useEffect, useMemo, useRef, useState } from 'react';
import { BatchBudgetExceededError } from '@/core/batch/runBatch';
import {
  AVAILABILITY,
  CARS_MOVES,
  defaultRhetoricSections,
  DISCUSSION_MOVES,
  rhetoricMetrics,
  VALIDITY_THREATS,
} from '@/core/rhetoric';
import type { Finding, Paper, PaperInsightsRecord, RhetoricCategory, RhetoricItem } from '@/core/schemas';
import { describeLlmError } from '@/shared/llm/describeError';
import { useLlm } from '@/shared/llm/LlmProvider';
import { estimateRhetoric, llmRhetoric } from '@/shared/llm/llmRhetoric';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { ActionBar } from '@/shared/ui/ActionBar';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { FindingCard, ReviewActions } from '@/shared/ui/FindingCard';
import { placeLabel } from './paperLabels';
import { usePaperScope, useRunBudget } from './paperScope';
import { RunSetup } from './RunSetup';
import { useReportJob } from './paperJobs';
import styles from './measurement.module.css';
import { Loading } from '@/shared/ui/StateNote';

type Location = Finding['locations'][number];
const LABELS: Record<RhetoricCategory, { name: string; help: string }> = {
  territory: { name: 'Xác lập lĩnh vực', help: 'Cho thấy lĩnh vực quan trọng hoặc đã biết gì.' },
  niche: { name: 'Chỉ ra khoảng trống', help: 'Nêu vấn đề, câu hỏi hoặc điều còn thiếu.' },
  occupy: { name: 'Lấp khoảng trống', help: 'Nêu bài này làm gì hoặc đóng góp gì.' },
  result_statement: { name: 'Nhắc lại kết quả', help: 'Nêu lại phát hiện khi diễn giải.' },
  comparison: { name: 'So sánh với nghiên cứu trước', help: 'Đặt kết quả cạnh công trình khác.' },
  explanation: { name: 'Giải thích', help: 'Đưa ra lý do cho kết quả.' },
  limitation: { name: 'Hạn chế', help: 'Tác giả nêu hạn chế của nghiên cứu.' },
  implication: { name: 'Hàm ý', help: 'Ý nghĩa với thực tiễn, lý thuyết hoặc nghiên cứu sau.' },
  threat_internal: { name: 'Validity nội tại', help: 'Yếu tố làm yếu suy luận nhân quả.' },
  threat_external: { name: 'Validity ngoại tại', help: 'Giới hạn khi khái quát sang bối cảnh khác.' },
  threat_construct: { name: 'Validity cấu trúc', help: 'Thước đo có đo đúng khái niệm không.' },
  threat_conclusion: { name: 'Validity kết luận', help: 'Năng lực thống kê, giả định, so sánh nhiều lần.' },
  data_availability: { name: 'Công bố dữ liệu', help: 'Dữ liệu lấy ở đâu, có công khai không.' },
  code_availability: { name: 'Công bố code', help: 'Code lấy ở đâu, có công khai không.' },
};
const GROUPS = {
  reporting: [
    { title: 'Đe doạ validity tác giả nêu', categories: VALIDITY_THREATS },
    { title: 'Công bố dữ liệu và code', categories: AVAILABILITY },
  ],
  moves: [
    { title: 'Moves ở Mở đầu (CARS)', categories: CARS_MOVES },
    { title: 'Moves ở Bàn luận', categories: DISCUSSION_MOVES },
  ],
};

export function PaperRhetoric({
  paper,
  focus,
  onLocation,
}: {
  paper: Paper;
  focus: 'reporting' | 'moves';
  onLocation: (location: Location) => void;
}) {
  const repo = useRepositories();
  const llm = useLlm();
  const [record, setRecord] = useState<PaperInsightsRecord>();
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = usePaperScope(paper, defaultRhetoricSections);
  const estimate = estimateRhetoric(paper, sections);
  const { budget, setBudget } = useRunBudget(estimate);
  // A resumed run gets a fresh allowance on top of the calls it already made.
  const [cap, setCap] = useState(0);
  const [used, setUsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void repo.paperInsights
      .get(paper.id)
      .then((value) => {
        if (active) setRecord(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [paper.id, repo]);
  async function start(resume: boolean) {
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setError('');
    const pending = resume ? (record?.rhetoricPending ?? null) : null;
    try {
      if (!(await llm.ensureConsent('paper')) || abort.signal.aborted) return;
      setUsed(pending?.callsUsed ?? 0);
      setCap((pending?.callsUsed ?? 0) + budget);
      const result = await llmRhetoric(llm.client, paper, {
        sectionIds: pending?.sectionIds ?? sections,
        config: llm.config,
        budget: (pending?.callsUsed ?? 0) + budget,
        pending,
        signal: abort.signal,
        onRequest: setUsed,
        onProgress: async (state) => {
          await repo.paperInsights.saveRhetoricPending(paper.id, state);
        },
      });
      if (abort.signal.aborted) return;
      setRecord(
        await repo.paperInsights.saveRhetoricRun(
          paper.id,
          result.run,
          result.incomplete ? result.state : null,
        ),
      );
      setShowSetup(false);
    } catch (cause) {
      setRecord(await repo.paperInsights.get(paper.id));
      if (!abort.signal.aborted)
        setError(
          cause instanceof BatchBudgetExceededError
            ? 'Đã chạm trần số lượt gọi. Phần đã đọc được giữ lại; bấm Tiếp tục để chạy phần còn lại.'
            : (describeLlmError(cause) ?? ''),
        );
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setRunning(false);
      }
    }
  }
  const run = record?.rhetoricRuns.at(-1);
  const decisions = useMemo(() => record?.decisions ?? [], [record]);
  const metrics = useMemo(() => (run ? rhetoricMetrics(run, decisions) : undefined), [run, decisions]);
  useReportJob('rhetoric', {
    running,
    done: Boolean(run) && !record?.rhetoricPending,
    estimate,
    ready: !loading,
    start: () => start(false),
  });
  if (loading) return <Loading label="Đang tải phân tích…" />;
  const decide = (itemId: string, decision: 'confirm' | 'dismiss' | 'reopen') => {
    if (!run) return;
    void repo.paperInsights
      .decide(paper.id, { run_id: run.id, item_id: itemId, decision })
      .then(setRecord)
      .catch((cause: unknown) => setError(String(cause)));
  };
  const stateLabel = (id: string) => {
    const state = metrics?.states.get(id);
    return state ? (
      <Badge tone={state === 'confirmed' ? 'success' : 'danger'}>
        {state === 'confirmed' ? 'Đã xác nhận' : 'Đã loại'}
      </Badge>
    ) : null;
  };
  const actions = (id: string) => (
    <ReviewActions
      decided={Boolean(metrics?.states.get(id))}
      dismissLabel="Loại bỏ"
      onConfirm={() => decide(id, 'confirm')}
      onDismiss={() => decide(id, 'dismiss')}
      onUndo={() => decide(id, 'reopen')}
    />
  );
  const open = (item: Pick<RhetoricItem, 'paragraphId' | 'start' | 'end'>) =>
    onLocation({ paragraphId: item.paragraphId, start: item.start, end: item.end });
  const setup = (
    <RunSetup
      paper={paper}
      sections={sections}
      onSections={setSections}
      estimate={estimate}
      budget={budget}
      onBudget={setBudget}
      running={running}
      disabled={!estimate}
      onStart={() => void start(false)}
      count={(section) =>
        paper.paragraphs.filter((p) => p.sectionId === section.id && p.kind === 'body').length
      }
    />
  );
  return (
    <div className={styles.panel}>
      <Card padding="md">
        {!run && <h2>Phân tích tu từ và mức độ báo cáo</h2>}
        {!run && (
          <p>
            Một lượt phân tích cho cả moves, validity, công bố dữ liệu và độ khớp Tóm tắt. AI đề xuất, code
            kiểm tra từng trích dẫn có thật trong bài, bạn xác nhận.
          </p>
        )}
        <ActionBar
          status={
            running ? (
              <span role="status">
                Đang phân tích… {used}/{cap || budget} lượt
              </span>
            ) : run ? (
              `Phân tích lúc ${new Date(run.createdAt).toLocaleString('vi-VN')} · ${run.sectionIds.length} mục · ${run.callsUsed} lượt gọi`
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
                <Button onClick={() => setShowSetup(!showSetup)}>
                  {showSetup ? 'Ẩn thiết lập' : 'Phân tích lại'}
                </Button>
              )}
              {record?.rhetoricPending && (
                <Button variant="primary" onClick={() => void start(true)}>
                  Tiếp tục phần còn lại
                </Button>
              )}
            </>
          )}
        </ActionBar>
        {(!run || showSetup) && !running && setup}
        {error && <div role="alert">{error}</div>}
        {run && run.failedSectionIds.length > 0 && (
          <p role="status">
            Chưa đọc được:{' '}
            {run.failedSectionIds
              .map((id) => paper.sections.find((s) => s.id === id)?.heading ?? id)
              .join(', ')}
            . Các mục này không được tính.
          </p>
        )}
      </Card>
      {run &&
        metrics &&
        GROUPS[focus].map((group) => (
          <Card key={group.title}>
            <h2>{group.title}</h2>
            <div className={styles.findings}>
              {group.categories.map((category) => {
                const items = metrics.live.filter((item) => item.category === category);
                const dismissed = run.items.filter(
                  (item) => item.category === category && metrics.states.get(item.id) === 'dismissed',
                );
                return (
                  <section key={category} aria-label={LABELS[category].name}>
                    <h3>
                      {LABELS[category].name} ({items.length})
                    </h3>
                    <p className={styles.note}>{LABELS[category].help}</p>
                    {items.length === 0 && <p>Chưa thấy trong các mục đã đọc.</p>}
                    <div className={styles.findings}>
                      {[...items, ...dismissed].map((item) => (
                        <FindingCard
                          key={item.id}
                          state={metrics.states.get(item.id) ?? 'open'}
                          labels={
                            <>
                              <Badge tone="accent">{LABELS[category].name}</Badge>
                              {stateLabel(item.id)}
                            </>
                          }
                          quote={item.excerpt}
                          source={{ label: placeLabel(paper, item.paragraphId), onOpen: () => open(item) }}
                          actions={actions(item.id)}
                        >
                          <p>{item.rationale}</p>
                        </FindingCard>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </Card>
        ))}
      {run && metrics && focus === 'moves' && (
        <Card>
          <h2>Độ khớp Tóm tắt với nội dung</h2>
          {!run.abstractChecked ? (
            <p>Chưa so sánh được, vì cần cả Tóm tắt và phần Kết quả hoặc Bàn luận trong các mục đã chọn.</p>
          ) : (
            <>
              <p>
                {metrics.supported}/{metrics.claims.length} khẳng định trong Tóm tắt tìm thấy đoạn tương ứng
                trong phần thân. Khẳng định chưa tìm thấy không có nghĩa là sai.
              </p>
              <div className={styles.findings}>
                {run.abstractClaims.map((claim) => (
                  <FindingCard
                    key={claim.id}
                    state={metrics.states.get(claim.id) ?? 'open'}
                    labels={
                      <>
                        <Badge tone={claim.support ? 'success' : 'warning'}>
                          {claim.support ? 'Có đoạn tương ứng' : 'Chưa tìm thấy'}
                        </Badge>
                        {stateLabel(claim.id)}
                      </>
                    }
                    quote={claim.claim.excerpt}
                    source={
                      claim.support
                        ? {
                            label: placeLabel(paper, claim.support.paragraphId),
                            onOpen: () => claim.support && open(claim.support),
                          }
                        : {
                            label: placeLabel(paper, claim.claim.paragraphId),
                            onOpen: () => open(claim.claim),
                          }
                    }
                    actions={actions(claim.id)}
                  >
                    <p>{claim.rationale}</p>
                  </FindingCard>
                ))}
              </div>
            </>
          )}
        </Card>
      )}
      {run && (
        <p className={styles.note}>
          Đã bỏ {run.discarded.not_found} đề xuất không tìm thấy trong bài và {run.discarded.duplicate} đề
          xuất trùng. Chưa qua hiệu chuẩn.
        </p>
      )}
    </div>
  );
}
