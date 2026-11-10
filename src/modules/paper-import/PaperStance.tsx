import { useEffect, useMemo, useRef, useState } from 'react';
import { BatchBudgetExceededError } from '@/core/batch/runBatch';
import {
  defaultStanceSections,
  planStance,
  stanceCsv,
  stanceMetrics,
  stanceStates,
  type CategoryMetric,
} from '@/core/stance';
import { type Paper, type StanceAnnotation, type StanceCategory, type StanceRecord } from '@/core/schemas';
import { downloadText } from '@/shared/calibration/download';
import { describeLlmError } from '@/shared/llm/describeError';
import { useLlm } from '@/shared/llm/LlmProvider';
import { llmStance } from '@/shared/llm/llmStance';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Badge } from '@/shared/ui/Badge';
import { ActionBar } from '@/shared/ui/ActionBar';
import { Button } from '@/shared/ui/Button';
import { FindingCard, ReviewActions } from '@/shared/ui/FindingCard';
import { Card } from '@/shared/ui/Card';
import { Select } from '@/shared/ui/Select';
import { Tree, type TreeNode } from '@/shared/ui/Tree';
import { usePaperScope, useRunBudget } from './paperScope';
import { RunSetup } from './RunSetup';
import { useReportJob } from './paperJobs';
import styles from './measurement.module.css';
import { Loading } from '@/shared/ui/StateNote';

const LABELS: Record<StanceCategory, { name: string; help: string }> = {
  hedges: { name: 'Rào đón (Hedges)', help: 'Giữ khoảng cách, chưa khẳng định hoàn toàn.' },
  boosters: { name: 'Nhấn mạnh (Boosters)', help: 'Tăng mức chắc chắn của khẳng định.' },
  attitude_markers: { name: 'Thái độ (Attitude markers)', help: 'Đánh giá hoặc cảm nhận của tác giả.' },
  self_mention: { name: 'Tự nhắc (Self-mention)', help: 'Tác giả xuất hiện trực tiếp trong bài.' },
  reader_pronouns: { name: 'Đại từ người đọc', help: 'Gọi hoặc kéo người đọc vào lập luận.' },
  directives: { name: 'Chỉ dẫn (Directives)', help: 'Hướng người đọc làm hoặc hiểu theo một cách.' },
  questions: { name: 'Câu hỏi', help: 'Tác giả đặt câu hỏi với người đọc.' },
  knowledge_reference: { name: 'Tri thức chung', help: 'Viện đến điều người đọc được xem là đã biết.' },
  asides: { name: 'Lời chen (Asides)', help: 'Lời bình ngắn xen vào giữa câu.' },
};
const PAGE_SIZE = 30;
const fmt = (value: number | null) =>
  value === null ? '—' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value);
type Location = { paragraphId: string; start: number; end: number };

export function PaperStance({
  paper,
  onLocation,
}: {
  paper: Paper;
  onLocation: (location: Location) => void;
}) {
  const repo = useRepositories();
  const llm = useLlm();
  const [record, setRecord] = useState<StanceRecord>();
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = usePaperScope(paper, defaultStanceSections);
  const estimate = planStance(paper, sections).length;
  const { budget, setBudget } = useRunBudget(estimate);
  // A resumed run gets a fresh allowance on top of the calls it already made.
  const [cap, setCap] = useState(0);
  const [used, setUsed] = useState(0);
  const [progress, setProgress] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [selected, setSelected] = useState('overview');
  const [sectionFilter, setSectionFilter] = useState('');
  const [page, setPage] = useState(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void repo.stance
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
    setProgress('');
    const pending = resume ? (record?.pending ?? null) : null;
    try {
      if (!(await llm.ensureConsent('paper')) || abort.signal.aborted) return;
      setUsed(pending?.callsUsed ?? 0);
      setCap((pending?.callsUsed ?? 0) + budget);
      const result = await llmStance(llm.client, paper, {
        sectionIds: pending?.sectionIds ?? sections,
        config: llm.config,
        budget: (pending?.callsUsed ?? 0) + budget,
        pending,
        signal: abort.signal,
        onRequest: setUsed,
        onChunk: (done, total) => setProgress(`Đã đọc ${done}/${total} phần`),
        onProgress: async (state) => {
          await repo.stance.savePending(paper.id, state);
        },
      });
      if (abort.signal.aborted) return;
      setRecord(await repo.stance.saveRun(paper.id, result.run, result.incomplete ? result.state : null));
      setSelected('overview');
      setShowSetup(false);
    } catch (cause) {
      setRecord(await repo.stance.get(paper.id));
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

  const run = record?.runs.at(-1);
  const decisions = useMemo(() => record?.decisions ?? [], [record]);
  const metrics = useMemo(() => (run ? stanceMetrics(run, decisions) : undefined), [run, decisions]);
  const states = useMemo(() => (run ? stanceStates(run, decisions) : new Map()), [run, decisions]);
  useReportJob('stance', {
    running,
    done: Boolean(run) && !record?.pending,
    estimate,
    ready: !loading,
    start: () => start(false),
    stop: () => controller.current?.abort(),
  });
  if (loading) return <Loading label="Đang tải phân tích giọng văn…" />;

  const heading = (id: string) => paper.sections.find((section) => section.id === id)?.heading ?? id;
  const allRows = metrics ? [...metrics.stance.rows, ...metrics.engagement.rows] : [];
  const nodes: TreeNode[] = metrics
    ? [
        { id: 'overview', label: 'Tổng quan' },
        {
          id: 'stance',
          label: 'Lập trường (Stance)',
          meta: metrics.stance.count,
          children: metrics.stance.rows.map((row) => ({
            id: row.category,
            label: LABELS[row.category].name,
            meta: row.count,
          })),
        },
        {
          id: 'engagement',
          label: 'Tương tác (Engagement)',
          meta: metrics.engagement.count,
          children: metrics.engagement.rows.map((row) => ({
            id: row.category,
            label: LABELS[row.category].name,
            meta: row.count,
          })),
        },
      ]
    : [];
  const decide = (annotation: StanceAnnotation, decision: 'confirm' | 'dismiss' | 'reopen') => {
    if (!run) return;
    void repo.stance
      .decide(paper.id, { run_id: run.id, annotation_id: annotation.id, decision })
      .then(setRecord)
      .catch((cause: unknown) => setError(String(cause)));
  };
  const table = (rows: CategoryMetric[], title: string) => (
    <>
      <h3>{title}</h3>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Loại</th>
              <th>Số lần</th>
              <th>Trên 1.000 từ</th>
              <th>Đã xác nhận</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.category}>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={LABELS[row.category].help}
                    onClick={() => {
                      setSelected(row.category);
                      setPage(0);
                    }}
                  >
                    {LABELS[row.category].name}
                  </Button>
                </td>
                <td>{row.count}</td>
                <td>{fmt(row.per1000)}</td>
                <td>{row.confirmed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
  const category = allRows.find((row) => row.category === selected)?.category;
  const listed =
    run && category
      ? run.annotations.filter(
          (item) => item.category === category && (!sectionFilter || item.sectionId === sectionFilter),
        )
      : [];
  const pages = Math.max(1, Math.ceil(listed.length / PAGE_SIZE));
  const visible = listed.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
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
        {!run && <h2>Phân tích lập trường và tương tác</h2>}
        {!run && (
          <p>
            Tìm các dấu hiệu tác giả thể hiện lập trường và tương tác với người đọc, theo mô hình của Hyland
            (2005). AI đề xuất, code kiểm tra từng dấu hiệu có thật trong bài, bạn xác nhận.
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
                <Button
                  variant="ghost"
                  onClick={() =>
                    downloadText(
                      `stance-${paper.id.slice(0, 8)}.csv`,
                      `\uFEFF${stanceCsv(run, decisions)}`,
                      'text/csv;charset=utf-8',
                    )
                  }
                >
                  Xuất CSV
                </Button>
              )}
              {run && (
                <Button onClick={() => setShowSetup(!showSetup)}>
                  {showSetup ? 'Ẩn thiết lập' : 'Phân tích lại'}
                </Button>
              )}
              {record?.pending && (
                <Button variant="primary" onClick={() => void start(true)}>
                  Tiếp tục phần còn lại
                </Button>
              )}
            </>
          )}
        </ActionBar>
        {(!run || showSetup) && !running && setup}
        {error && <div role="alert">{error}</div>}
      </Card>
      {run && metrics && (
        <div className={styles.workspace}>
          <div className={styles.nav}>
            <Card padding="md">
              <Tree
                label="Phân loại giọng văn"
                nodes={nodes}
                selectedId={selected}
                onSelect={(id) => {
                  setSelected(id);
                  setPage(0);
                }}
              />
            </Card>
          </div>
          <div className={styles.detail}>
            {!category && (
              <Card>
                <h2>Tổng quan giọng văn</h2>
                <p>
                  {fmt(metrics.words)} từ đã đọc · {run.annotations.length} dấu hiệu · đã xác nhận{' '}
                  {metrics.confirmed}
                </p>
                {run.failedSectionIds.length > 0 && (
                  <p role="status">
                    Chưa đọc được: {run.failedSectionIds.map(heading).join(', ')}. Các mục này không được tính
                    vào số liệu.
                  </p>
                )}
                {(selected === 'overview' || selected === 'stance') &&
                  table(metrics.stance.rows, `Lập trường: ${fmt(metrics.stance.per1000)} trên 1.000 từ`)}
                {(selected === 'overview' || selected === 'engagement') &&
                  table(
                    metrics.engagement.rows,
                    `Tương tác: ${fmt(metrics.engagement.per1000)} trên 1.000 từ`,
                  )}
                {selected === 'overview' && (
                  <details className={styles.missing}>
                    <summary>Theo từng mục ({metrics.sections.length})</summary>
                    <div className={styles.scroll}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Mục</th>
                            <th>Từ</th>
                            <th>Lập trường</th>
                            <th>Tương tác</th>
                            <th>Trên 1.000 từ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {metrics.sections.map((section) => (
                            <tr key={section.sectionId}>
                              <td>{heading(section.sectionId)}</td>
                              <td>{section.words}</td>
                              <td>{section.stance}</td>
                              <td>{section.engagement}</td>
                              <td>{fmt(section.per1000)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
                <p className={styles.note}>
                  Đây là số liệu mô tả, chưa qua hiệu chuẩn và không phải điểm chất lượng. AI đề xuất các dấu
                  hiệu theo ngữ cảnh nên có thể bỏ sót hoặc gán sai. Mục bị loại không tính vào số liệu. Code
                  đã bỏ {run.discarded.not_found} đề xuất không tìm thấy trong bài, {run.discarded.wrong_form}{' '}
                  đề xuất sai dạng, {run.discarded.duplicate} đề xuất trùng.
                </p>
              </Card>
            )}
            {category && (
              <Card>
                <h2>{LABELS[category].name}</h2>
                <p className={styles.note}>{LABELS[category].help}</p>
                <Select
                  label="Lọc theo mục"
                  size="sm"
                  value={sectionFilter}
                  onChange={(event) => {
                    setSectionFilter(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">Tất cả</option>
                  {metrics.sections.map((section) => (
                    <option key={section.sectionId} value={section.sectionId}>
                      {heading(section.sectionId)}
                    </option>
                  ))}
                </Select>
                {visible.length === 0 && <p>Không có dấu hiệu nào.</p>}
                <div className={styles.findings}>
                  {visible.map((item) => {
                    const state = states.get(item.id);
                    const position = item.excerpt.toLowerCase().indexOf(item.marker.toLowerCase());
                    return (
                      <FindingCard
                        key={item.id}
                        state={state ?? 'open'}
                        labels={
                          <>
                            <Badge tone="accent">{LABELS[category].name}</Badge>
                            {state && (
                              <Badge tone={state === 'confirmed' ? 'success' : 'danger'}>
                                {state === 'confirmed' ? 'Đã xác nhận' : 'Đã loại'}
                              </Badge>
                            )}
                          </>
                        }
                        quote={
                          position < 0 ? (
                            item.excerpt
                          ) : (
                            <>
                              {item.excerpt.slice(0, position)}
                              <mark>{item.excerpt.slice(position, position + item.marker.length)}</mark>
                              {item.excerpt.slice(position + item.marker.length)}
                            </>
                          )
                        }
                        source={{
                          label: `${item.page ? `Tr. ${item.page}` : 'Không rõ trang'} · ${heading(item.sectionId)}`,
                          onOpen: () =>
                            onLocation({ paragraphId: item.paragraphId, start: item.start, end: item.end }),
                        }}
                        actions={
                          <ReviewActions
                            decided={Boolean(state)}
                            dismissLabel="Loại bỏ"
                            onConfirm={() => decide(item, 'confirm')}
                            onDismiss={() => decide(item, 'dismiss')}
                            onUndo={() => decide(item, 'reopen')}
                          />
                        }
                      >
                        <p>{item.rationale}</p>
                      </FindingCard>
                    );
                  })}
                </div>
                {pages > 1 && (
                  <div className={styles.meta}>
                    <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                      Trang trước
                    </Button>
                    <span>
                      Trang {page + 1}/{pages}
                    </span>
                    <Button size="sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                      Trang sau
                    </Button>
                  </div>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
