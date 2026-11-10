import { useEffect, useMemo, useRef, useState } from 'react';
import { argumentMetrics, planArguments } from '@/core/argument';
import { BatchBudgetExceededError } from '@/core/batch/runBatch';
import { defaultRhetoricSections } from '@/core/rhetoric';
import type { Argument, Finding, Paper, PaperInsightsRecord } from '@/core/schemas';
import { describeLlmError } from '@/shared/llm/describeError';
import { useLlm } from '@/shared/llm/LlmProvider';
import { llmArgument } from '@/shared/llm/llmArgument';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { ActionBar, Stat, StatGrid } from '@/shared/ui/ActionBar';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { FindingCard, ReviewActions } from '@/shared/ui/FindingCard';
import { placeLabel } from './paperLabels';
import { usePaperScope, useRunBudget } from './paperScope';
import { RunSetup } from './RunSetup';
import styles from './argument.module.css';
import { Loading } from '@/shared/ui/StateNote';

type Location = Finding['locations'][number];
type Span = Argument['claim'];
const NOT_IDENTIFIED = 'Chưa xác định';

export function PaperArguments({
  paper,
  view,
  onLocation,
}: {
  paper: Paper;
  view: 'toulmin' | 'aif';
  onLocation: (location: Location) => void;
}) {
  const repo = useRepositories();
  const llm = useLlm();
  const [record, setRecord] = useState<PaperInsightsRecord>();
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = usePaperScope(paper, defaultRhetoricSections);
  const estimate = planArguments(paper, sections).length;
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
    const pending = resume ? (record?.argumentPending ?? null) : null;
    try {
      if (!(await llm.ensureConsent('paper')) || abort.signal.aborted) return;
      setUsed(pending?.callsUsed ?? 0);
      setCap((pending?.callsUsed ?? 0) + budget);
      const result = await llmArgument(llm.client, paper, {
        sectionIds: pending?.sectionIds ?? sections,
        config: llm.config,
        budget: (pending?.callsUsed ?? 0) + budget,
        pending,
        signal: abort.signal,
        onRequest: setUsed,
        onProgress: async (state) => {
          await repo.paperInsights.saveArgumentPending(paper.id, state);
        },
      });
      if (abort.signal.aborted) return;
      setRecord(
        await repo.paperInsights.saveArgumentRun(
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
  const run = record?.argumentRuns.at(-1);
  const decisions = useMemo(() => record?.decisions ?? [], [record]);
  const metrics = useMemo(() => (run ? argumentMetrics(run, decisions) : undefined), [run, decisions]);
  if (loading) return <Loading label="Đang tải lập luận…" />;
  const open = (span: Span) =>
    onLocation({ paragraphId: span.paragraphId, start: span.start, end: span.end });
  const decide = (id: string, decision: 'confirm' | 'dismiss' | 'reopen') => {
    if (!run) return;
    void repo.paperInsights
      .decide(paper.id, { run_id: run.id, item_id: id, decision })
      .then(setRecord)
      .catch((cause: unknown) => setError(String(cause)));
  };
  const quotes = (spans: Span[]) =>
    spans.length === 0 ? (
      <span className={styles.empty}>{NOT_IDENTIFIED}</span>
    ) : (
      <ul className={styles.quotes}>
        {spans.map((span) => (
          <li key={`${span.paragraphId}:${span.start}`}>
            <span>“{span.excerpt}”</span>{' '}
            <Button variant="ghost" size="sm" onClick={() => open(span)}>
              {placeLabel(paper, span.paragraphId)}
            </Button>
          </li>
        ))}
      </ul>
    );
  const percent = ({ count, total }: { count: number; total: number }) => (total ? `${count}/${total}` : '—');
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
  const same = (a: Span | null, b: Span) =>
    a !== null && a.paragraphId === b.paragraphId && a.start === b.start && a.end === b.end;
  const roleOf = (item: Argument, span: Span) =>
    item.data.some((datum) => same(datum, span))
      ? 'dữ liệu'
      : same(item.statedWarrant, span)
        ? 'warrant'
        : 'backing';
  const nodeText = (id: string) => metrics?.graph.nodes.find((node) => node.id === id)?.span;
  return (
    <div className={styles.panel}>
      <Card padding="md">
        {!run && <h2>Phân tích lập luận</h2>}
        {!run && (
          <p>
            Tìm các luận điểm của tác giả và cấu trúc của chúng theo Toulmin. AI đề xuất, code kiểm tra từng
            trích dẫn, bạn xác nhận. Đây là mô tả cấu trúc, không kết luận lập luận đúng hay sai.
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
              {record?.argumentPending && (
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
            .
          </p>
        )}
      </Card>
      {run && metrics && view === 'toulmin' && (
        <>
          <Card>
            <h2>Luận điểm chính: {metrics.main.length}</h2>
            <StatGrid>
              <Stat value={percent(metrics.withData)} label="Có dữ liệu" />
              <Stat value={percent(metrics.statedWarrant)} label="Warrant do tác giả nêu" />
              <Stat value={percent(metrics.inferredWarrant)} label="Warrant do AI suy ra" />
              <Stat value={percent(metrics.withBacking)} label="Có backing" />
              <Stat value={percent(metrics.withQualifier)} label="Có giới hạn (qualifier)" />
              <Stat value={percent(metrics.withRebuttal)} label="Có xử lý phản biện" />
              <Stat value={metrics.unsupported.length} label="Luận điểm chưa thấy tiền đề" />
              <Stat value={metrics.dangling.length} label="Luận điểm phụ chưa nối vào đâu" />
            </StatGrid>
          </Card>
          {[
            ...metrics.live,
            ...run.arguments.filter((item) => metrics.states.get(item.id) === 'dismissed'),
          ].map((item) => {
            const state = metrics.states.get(item.id);
            return (
              <FindingCard
                key={item.id}
                state={state ?? 'open'}
                labels={
                  <>
                    <Badge tone={item.importance === 'main' ? 'accent' : 'neutral'}>
                      {item.importance === 'main' ? 'Luận điểm chính' : 'Luận điểm phụ'}
                    </Badge>
                    {state && (
                      <Badge tone={state === 'confirmed' ? 'success' : 'danger'}>
                        {state === 'confirmed' ? 'Đã xác nhận' : 'Đã loại'}
                      </Badge>
                    )}
                  </>
                }
                quote={item.claim.excerpt}
                source={{ label: placeLabel(paper, item.claim.paragraphId), onOpen: () => open(item.claim) }}
                actions={
                  <ReviewActions
                    decided={Boolean(state)}
                    dismissLabel="Loại bỏ"
                    onConfirm={() => decide(item.id, 'confirm')}
                    onDismiss={() => decide(item.id, 'dismiss')}
                    onUndo={() => decide(item.id, 'reopen')}
                  />
                }
              >
                <dl className={styles.slots}>
                  <dt>Dữ liệu</dt>
                  <dd>{quotes(item.data)}</dd>
                  <dt>Warrant</dt>
                  <dd>
                    {item.statedWarrant ? (
                      quotes([item.statedWarrant])
                    ) : item.inferredWarrant ? (
                      <>
                        <Badge tone="warning">AI suy ra, tác giả không nêu</Badge> {item.inferredWarrant}
                      </>
                    ) : (
                      <span className={styles.empty}>{NOT_IDENTIFIED}</span>
                    )}
                  </dd>
                  <dt>Backing</dt>
                  <dd>{quotes(item.backing)}</dd>
                  <dt>Giới hạn</dt>
                  <dd>{quotes(item.qualifier ? [item.qualifier] : [])}</dd>
                  <dt>Phản biện</dt>
                  <dd>{quotes(item.rebuttals)}</dd>
                </dl>
              </FindingCard>
            );
          })}
          <p className={styles.note}>
            Đã bỏ {run.discarded.claim_not_found} luận điểm và {run.discarded.element_not_found} thành phần
            không tìm thấy trong bài, {run.discarded.duplicate} luận điểm trùng. Chưa qua hiệu chuẩn.
          </p>
        </>
      )}
      {run && metrics && view === 'aif' && (
        <Card>
          <h2>Sơ đồ lập luận</h2>
          <p className={styles.note}>
            Nút I là nội dung trong bài. RA là bước suy luận nối tiền đề với kết luận. CA là bước phản bác.
          </p>
          <ul className={styles.graph}>
            {metrics.live.map((item) => {
              const conclusion = metrics.graph.nodes.find(
                (node) =>
                  node.kind === 'I' &&
                  node.span?.paragraphId === item.claim.paragraphId &&
                  node.span.start < item.claim.end &&
                  item.claim.start < node.span.end,
              );
              const into = metrics.graph.edges.filter((edge) => edge.to === conclusion?.id);
              return (
                <li key={item.id}>
                  <div className={styles.node}>
                    <Badge tone="accent">I</Badge> {item.claim.excerpt}
                  </div>
                  {into.length === 0 && <p className={styles.empty}>Chưa thấy tiền đề.</p>}
                  <ul className={styles.graph}>
                    {into.map((edge) => {
                      const kind = edge.from.startsWith('ca-') ? 'CA' : 'RA';
                      return (
                        <li key={edge.from}>
                          <div className={styles.node}>
                            <Badge tone={kind === 'CA' ? 'danger' : 'success'}>{kind}</Badge>
                          </div>
                          <ul className={styles.graph}>
                            {metrics.graph.edges
                              .filter((inner) => inner.to === edge.from)
                              .map((inner) => {
                                const span = nodeText(inner.from);
                                return (
                                  span && (
                                    <li key={inner.from} className={styles.node}>
                                      <Badge>I · {kind === 'CA' ? 'phản bác' : roleOf(item, span)}</Badge>{' '}
                                      {span.excerpt}{' '}
                                      <Button variant="ghost" size="sm" onClick={() => open(span)}>
                                        {placeLabel(paper, span.paragraphId)}
                                      </Button>
                                    </li>
                                  )
                                );
                              })}
                          </ul>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
