import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  acceptTriage,
  addPapers,
  borderlineSample,
  bucketOf,
  candidateFromWork,
  criteriaOf,
  decideCandidate,
  DEFAULT_THRESHOLDS,
  emptyDeep,
  estimateTriage,
  isGrounded,
  mergeCandidates,
  paperEvidence,
  papersFromCandidates,
  sortByScore,
  synthesisInput,
  synthesisMarkdown,
  triageBuckets,
  type Thresholds,
  type TriageBucket,
  type TriageSort,
} from '@/core/extraction';
import type {
  Candidate,
  DeepResearch as Deep,
  ExtractionProject,
  ScreeningStatus,
  SearchPlan,
  SearchRound,
} from '@/core/schemas';
import { downloadText } from '@/shared/calibration/download';
import { describeLlmError } from '@/shared/llm/describeError';
import { useLlm } from '@/shared/llm/LlmProvider';
import { llmSearchPlan, llmSynthesis, llmTriage } from '@/shared/llm/llmDeepResearch';
import { createScholarClient } from '@/shared/scholar/client';
import { ActionBar } from '@/shared/ui/ActionBar';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Chip } from '@/shared/ui/Chip';
import { TextField } from '@/shared/ui/TextField';
import { GroundingDrawer, type GroundingTarget } from './GroundingDrawer';
import { BUCKET_LABEL } from './labels';
import { TriageDetails, TriagePanel, type TriageFilter } from './ScreeningTriage';
import styles from './extraction.module.css';
import { Empty } from '@/shared/ui/StateNote';

type Save = (
  next: ExtractionProject,
  event?: { action: 'run_extraction' | 'review_extraction'; after: unknown },
) => Promise<void>;

const SCREEN: Record<ScreeningStatus, { label: string; tone: 'neutral' | 'success' | 'danger' | 'warning' }> =
  {
    candidate: { label: 'Chưa sàng lọc', tone: 'neutral' },
    included: { label: 'Chọn', tone: 'success' },
    excluded: { label: 'Loại', tone: 'danger' },
    uncertain: { label: 'Chưa chắc', tone: 'warning' },
  };
const CLAIM_TITLES = {
  theme: 'Chủ đề chung',
  agreement: 'Điểm thống nhất',
  disagreement: 'Điểm khác biệt',
  gap: 'Research gap cần xác minh',
} as const;
/** Citation expansion follows at most this many included papers per click, both directions. */
const EXPAND_PAPERS = 5;
const EXPAND_PER = 10;

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
const year = (text: string) => (/^\d{4}$/.test(text.trim()) ? Number(text.trim()) : null);

interface Draft {
  queries: string;
  inclusion: string;
  exclusion: string;
  fromYear: string;
  toYear: string;
}
export interface SearchDraft extends Draft {
  question: string;
}
const draftOf = (plan: SearchPlan | null): Draft => ({
  queries: plan?.queries.join('\n') ?? '',
  inclusion: plan?.inclusion.join('\n') ?? '',
  exclusion: plan?.exclusion.join('\n') ?? '',
  fromYear: plan?.fromYear ? String(plan.fromYear) : '',
  toYear: plan?.toYear ? String(plan.toYear) : '',
});

export function DeepResearch({
  project,
  onSave,
  onOpenMatrix,
  screeningStorage,
  draft: savedDraft,
  onDraftChange,
}: {
  project: ExtractionProject;
  onSave: Save;
  draft?: SearchDraft;
  onDraftChange?: (draft: SearchDraft) => void;
  screeningStorage?: {
    checkpoint: (project: ExtractionProject) => Promise<void>;
    finish: (events: ExtractionEvent[]) => Promise<void>;
  };
  /** Shows the papers once they are in the project, where a view of them exists. */
  onOpenMatrix?: () => void;
}) {
  const llm = useLlm();
  const [params, setParams] = useSearchParams();
  const deep = project.deep ?? emptyDeep();
  const [question, setQuestion] = useState(savedDraft?.question ?? project.researchQuestion);
  const [draft, setDraft] = useState(() =>
    savedDraft
      ? {
          queries: savedDraft.queries,
          inclusion: savedDraft.inclusion,
          exclusion: savedDraft.exclusion,
          fromYear: savedDraft.fromYear,
          toYear: savedDraft.toYear,
        }
      : draftOf(deep.plan),
  );
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<ScreeningStatus | 'all'>('all');
  const [grounding, setGrounding] = useState<GroundingTarget | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [aiFilter, setAiFilter] = useState<TriageFilter>('all');
  const [sort, setSort] = useState<TriageSort>('default');
  const steps = ['plan', 'find', 'screen', 'synthesis'] as const;
  type Step = (typeof steps)[number];
  const requestedStep = params.get('searchStep');
  const activeStep: Step = steps.includes(requestedStep as Step) ? (requestedStep as Step) : 'plan';
  const selectStep = (step: Step) => {
    const next = new URLSearchParams(params);
    next.set('searchStep', step);
    setParams(next);
  };
  const updateQuestion = (value: string) => {
    setQuestion(value);
    onDraftChange?.({ ...draft, question: value });
  };
  const updateDraft = (value: Draft) => {
    setDraft(value);
    onDraftChange?.({ ...value, question });
  };
  const controller = useRef<AbortController | null>(null);
  /** The latest project, so a checkpoint saved mid-run merges onto decisions made meanwhile. */
  const current = useRef(project);
  useEffect(() => {
    current.current = project;
  }, [project]);
  const plan = deep.plan;
  const queryCount = lines(draft.queries).length;
  const inclusionCount = lines(draft.inclusion).length;
  const exclusionCount = lines(draft.exclusion).length;
  const planFromDraft = (): SearchPlan => ({
    concepts: plan?.concepts ?? [],
    queries: lines(draft.queries).slice(0, 8),
    inclusion: lines(draft.inclusion),
    exclusion: lines(draft.exclusion),
    fromYear: year(draft.fromYear),
    toYear: year(draft.toYear),
    perQuery: plan?.perQuery ?? 15,
    approvedAt: null,
  });
  const dirty = JSON.stringify(draftOf(plan)) !== JSON.stringify(draft);
  const approved = Boolean(plan?.approvedAt) && !dirty;
  const withDeep = (next: Partial<Deep>, base = project): ExtractionProject => ({
    ...base,
    researchQuestion: question.trim(),
    deep: { ...(base.deep ?? emptyDeep()), ...next },
  });

  async function task(label: string, work: (signal: AbortSignal) => Promise<void>) {
    const abort = new AbortController();
    controller.current = abort;
    setBusy(label);
    setError('');
    try {
      await work(abort.signal);
    } catch (cause) {
      if (!abort.signal.aborted) setError(describeLlmError(cause) ?? String(cause));
    } finally {
      setBusy('');
      controller.current = null;
    }
  }
  const ai = async (signal: AbortSignal) => (await llm.ensureConsent('paper')) && !signal.aborted;

  const proposePlan = () =>
    task('Đang đề xuất kế hoạch…', async (signal) => {
      if (!(await ai(signal))) return;
      const next = await llmSearchPlan(llm.client, question.trim(), { config: llm.config, signal });
      updateDraft(draftOf(next));
      await onSave(withDeep({ plan: next }), { action: 'run_extraction', after: { step: 'search_plan' } });
    });
  const approvePlan = () =>
    void onSave(withDeep({ plan: { ...planFromDraft(), approvedAt: new Date().toISOString() } }), {
      action: 'review_extraction',
      after: { step: 'approve_plan' },
    });

  const round = (
    kind: SearchRound['kind'],
    input: string,
    found: number,
    added: number,
    note: string | null,
  ) => ({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind,
    input,
    found,
    added,
    note,
  });
  const search = () =>
    task('Đang tìm trên OpenAlex…', async (signal) => {
      if (!plan) return;
      const scholar = createScholarClient({});
      let candidates = deep.candidates;
      const rounds: SearchRound[] = [];
      for (const query of plan.queries) {
        if (signal.aborted) break;
        try {
          const { results, total } = await scholar.searchWorks(
            query,
            { fromYear: plan.fromYear, toYear: plan.toYear, perPage: plan.perQuery },
            signal,
          );
          const found = results.flatMap((work) => candidateFromWork(work, query) ?? []);
          const merged = mergeCandidates(candidates, found);
          candidates = merged.candidates;
          rounds.push(round('query', query, found.length, merged.added, `OpenAlex có ${total} kết quả`));
        } catch (cause) {
          rounds.push(round('query', query, 0, 0, `Lỗi: ${String(cause)}`));
        }
      }
      await onSave(withDeep({ candidates, rounds: [...deep.rounds, ...rounds] }));
    });
  const expand = () =>
    task('Đang mở rộng theo trích dẫn…', async (signal) => {
      const scholar = createScholarClient({});
      const seeds = deep.candidates.filter((item) => item.status === 'included').slice(0, EXPAND_PAPERS);
      let candidates = deep.candidates;
      const rounds: SearchRound[] = [];
      for (const seed of seeds) {
        if (!seed.openalexId) {
          rounds.push(round('cites', seed.title, 0, 0, 'Không có mã OpenAlex, bỏ qua'));
          continue;
        }
        for (const direction of ['cites', 'cited_by'] as const) {
          if (signal.aborted) break;
          // `cites:X` finds works citing X; `cited_by:X` finds works X cites.
          const works = await scholar.citationWorks(seed.openalexId, direction, EXPAND_PER, signal);
          const found = works.flatMap(
            (work) =>
              candidateFromWork(
                work,
                `${direction === 'cites' ? 'trích dẫn' : 'được trích bởi'}: ${seed.title}`,
              ) ?? [],
          );
          const merged = mergeCandidates(candidates, found);
          candidates = merged.candidates;
          rounds.push(
            round(
              direction,
              seed.title,
              found.length,
              merged.added,
              found.length ? null : 'Không có dữ liệu',
            ),
          );
        }
      }
      await onSave(withDeep({ candidates, rounds: [...deep.rounds, ...rounds] }));
    });
  const estimate = estimateTriage(deep.candidates);
  const criteria = criteriaOf(plan ?? { inclusion: [], exclusion: [] });
  const screen = () =>
    task('Đang chấm điểm sàng lọc…', async (signal) => {
      if (!(plan || question.trim()) || !(await ai(signal))) return;
      const events: ExtractionEvent[] = [];
      try {
        await llmTriage(
          llm.client,
          question.trim(),
          plan ?? { inclusion: [], exclusion: [] },
          deep.candidates,
          {
            config: llm.config,
            signal,
            // A checkpoint per batch: a stop or a failure keeps every batch already graded.
            onBatch: async ({ apply, index, total }) => {
              const base = current.current;
              const next = withDeep({ candidates: apply(base.deep?.candidates ?? []) }, base);
              current.current = next;
              setBusy(`Đang chấm điểm sàng lọc… lô ${index + 1}/${total}`);
              const event: ExtractionEvent = {
                action: 'run_extraction',
                after: { step: 'screening_triage', batch: index + 1, of: total },
              };
              if (screeningStorage) {
                await screeningStorage.checkpoint(next);
                events.push(event);
              } else await onSave(next, event);
            },
          },
        );
      } finally {
        await screeningStorage?.finish(events);
      }
    });
  const decide = (candidate: Candidate, status: ScreeningStatus) =>
    void onSave(
      withDeep({
        candidates: decideCandidate(deep.candidates, candidate.key, status, new Date().toISOString()),
      }),
      { action: 'review_extraction', after: { step: 'screen', key: candidate.key, status } },
    );
  /** Applies the AI bucket as the person's decision; only after a click, and for many papers after a confirm. */
  const accept = (bucket: TriageBucket, keys: string[]) => {
    const { candidates, applied } = acceptTriage(
      deep.candidates,
      keys,
      bucket,
      thresholds,
      new Date().toISOString(),
    );
    if (!applied) return;
    void onSave(withDeep({ candidates }), {
      action: 'review_extraction',
      after: { step: 'screen_triage_accept', bucket, applied, thresholds, source: 'ai_accepted' },
    });
  };
  const buckets = triageBuckets(deep.candidates, thresholds);
  const borderline = borderlineSample(deep.candidates, thresholds);
  const existing = new Set(project.papers.map((paper) => paper.key));
  const incoming = papersFromCandidates(deep.candidates).filter((paper) => !existing.has(paper.key));
  const bring = async () => {
    await onSave(withDeep({}, addPapers(project, incoming)));
    onOpenMatrix?.();
  };
  const ready = synthesisInput(project).length;
  const synthesize = () =>
    task('Đang tổng hợp…', async (signal) => {
      if (!(await ai(signal))) return;
      const synthesis = await llmSynthesis(llm.client, project, { config: llm.config, signal });
      await onSave(withDeep({ syntheses: [...deep.syntheses, synthesis] }), {
        action: 'run_extraction',
        after: { step: 'synthesis', claims: synthesis.claims.length, dropped: synthesis.droppedRefs },
      });
    });
  const latest = deep.syntheses.at(-1);
  const numberOf = (key: string) => (latest?.paperKeys.indexOf(key) ?? -1) + 1;
  const hasGrounding = Boolean(latest?.claims.some((claim) => claim.citations.length > 0));
  const titleOf = (key: string) => project.papers.find((paper) => paper.key === key)?.title ?? key;
  const shown = sortByScore(
    deep.candidates.filter(
      (item) =>
        (filter === 'all' || item.status === filter) &&
        (aiFilter === 'all' ||
          (aiFilter === 'check'
            ? borderline.includes(item.key)
            : item.status === 'candidate' && bucketOf(item, thresholds) === aiFilter)),
    ),
    sort,
  );
  const count = (status: ScreeningStatus) => deep.candidates.filter((item) => item.status === status).length;
  const stepDone = [
    approved,
    deep.rounds.length > 0,
    deep.candidates.some((item) => item.status !== 'candidate'),
    Boolean(latest),
  ];
  const stepBlocked = [false, !approved, deep.candidates.length === 0, ready < 2];
  const stepLabels = ['Kế hoạch tìm kiếm', 'Tìm bài', 'Sàng lọc', 'Tổng hợp liên bài'] as const;

  return (
    <div className={styles.deep}>
      <ActionBar
        busy={Boolean(busy)}
        status={
          busy ? (
            <span role="status">{busy}</span>
          ) : (
            'AI chỉ đề xuất; bạn duyệt kế hoạch và quyết định chọn bài.'
          )
        }
      >
        {busy && (
          <Button variant="danger" onClick={() => controller.current?.abort()}>
            Dừng
          </Button>
        )}
      </ActionBar>
      {error && <p role="alert">{error}</p>}

      <nav className={styles.researchSteps} aria-label="Các bước AutoResearch">
        {steps.map((step, index) => (
          <Button
            key={step}
            variant="ghost"
            className={styles.researchStep}
            data-active={activeStep === step}
            data-complete={stepDone[index]}
            data-blocked={stepBlocked[index]}
            aria-current={activeStep === step ? 'step' : undefined}
            onClick={() => selectStep(step)}
          >
            <span className={styles.stepNumber}>{stepDone[index] ? '✓' : index + 1}</span>
            <span className={styles.stepCopy}>
              <strong>{stepLabels[index]}</strong>
              <small>
                {activeStep === step
                  ? 'Đang mở'
                  : stepDone[index]
                    ? 'Đã hoàn thành'
                    : stepBlocked[index]
                      ? 'Còn điều kiện'
                      : 'Chưa bắt đầu'}
              </small>
            </span>
          </Button>
        ))}
      </nav>

      {activeStep === 'plan' && (
        <div className={styles.planLayout}>
          <Card className={`${styles.stepContent} ${styles.planForm}`}>
            <header className={styles.planHeader}>
              <div>
                <span className={styles.planEyebrow}>BƯỚC 1 / 4</span>
                <h2>Kế hoạch tìm kiếm</h2>
                <p>Chuẩn bị câu hỏi, truy vấn và tiêu chí trước khi tìm bài.</p>
              </div>
              {approved ? <Badge tone="success">Đã duyệt</Badge> : <Badge>Bản nháp</Badge>}
            </header>
            <TextField
              label="Research question"
              multiline
              rows={2}
              controlClassName={styles.planControl}
              value={question}
              onChange={(event) => updateQuestion(event.target.value)}
              labelAction={
                <Button
                  size="sm"
                  leadingIcon={<Sparkles size={16} aria-hidden="true" />}
                  disabled={Boolean(busy) || !question.trim()}
                  onClick={() => void proposePlan()}
                >
                  Đề xuất kế hoạch (AI)
                </Button>
              }
            />
            <div className={styles.planQueries}>
              <TextField
                label="Truy vấn (mỗi dòng một truy vấn · tối đa 8 dòng)"
                multiline
                rows={2}
                controlClassName={styles.planControl}
                value={draft.queries}
                onChange={(event) => updateDraft({ ...draft, queries: event.target.value })}
              />
              <span className={styles.queryCount}>{queryCount} / 8 truy vấn</span>
            </div>
            <div className={styles.twoCols}>
              <TextField
                label="Tiêu chí chọn (mỗi dòng một tiêu chí)"
                multiline
                rows={2}
                controlClassName={styles.planControl}
                value={draft.inclusion}
                onChange={(event) => updateDraft({ ...draft, inclusion: event.target.value })}
              />
              <TextField
                label="Tiêu chí loại"
                multiline
                rows={2}
                controlClassName={styles.planControl}
                value={draft.exclusion}
                onChange={(event) => updateDraft({ ...draft, exclusion: event.target.value })}
              />
              <TextField
                label="Từ năm"
                type="number"
                step={1}
                controlClassName={styles.planControl}
                value={draft.fromYear}
                onChange={(event) => updateDraft({ ...draft, fromYear: event.target.value })}
              />
              <TextField
                label="Đến năm"
                type="number"
                step={1}
                controlClassName={styles.planControl}
                value={draft.toYear}
                onChange={(event) => updateDraft({ ...draft, toYear: event.target.value })}
              />
            </div>
            <footer className={styles.planActions}>
              <div>
                {approved ? (
                  <span className={styles.planHint}>Kế hoạch đã sẵn sàng cho bước Tìm bài.</span>
                ) : queryCount > 8 ? (
                  <span className={styles.planHint}>Giảm truy vấn còn tối đa 8 dòng để duyệt.</span>
                ) : queryCount === 0 ? (
                  <span className={styles.planHint}>Thêm ít nhất một truy vấn để duyệt kế hoạch.</span>
                ) : (
                  <span className={styles.planHint}>
                    Bạn có thể chỉnh truy vấn và tiêu chí trước khi duyệt.
                  </span>
                )}
                {plan?.approvedAt && dirty && <Badge tone="warning">Đã sửa, cần duyệt lại</Badge>}
              </div>
              <Button
                variant="primary"
                disabled={approved || queryCount === 0 || queryCount > 8 || Boolean(busy)}
                onClick={approvePlan}
              >
                {approved ? 'Đã duyệt' : 'Duyệt kế hoạch'}
              </Button>
            </footer>
          </Card>
          <aside className={styles.planAside} aria-label="Tóm tắt kế hoạch">
            <span className={styles.planEyebrow}>TÌNH TRẠNG KẾ HOẠCH</span>
            <h3 className={styles.planAsideTitle}>
              {approved ? 'Sẵn sàng tìm bài' : plan?.approvedAt && dirty ? 'Cần duyệt lại' : 'Đang soạn'}
            </h3>
            <p className={styles.planAsideCopy}>
              AI chỉ đề xuất. Bạn kiểm tra và duyệt kế hoạch trước khi truy vấn OpenAlex.
            </p>
            <dl className={styles.planStats}>
              <div>
                <dt>Truy vấn</dt>
                <dd>{queryCount} / 8</dd>
              </div>
              <div>
                <dt>Tiêu chí chọn</dt>
                <dd>{inclusionCount}</dd>
              </div>
              <div>
                <dt>Tiêu chí loại</dt>
                <dd>{exclusionCount}</dd>
              </div>
              <div>
                <dt>Khoảng năm</dt>
                <dd>
                  {year(draft.fromYear) ?? 'Không giới hạn'} – {year(draft.toYear) ?? 'hiện tại'}
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      )}

      {activeStep === 'find' && (
        <Card className={`${styles.stepContent} ${styles.findStep}`}>
          <header className={styles.stepHeader}>
            <div>
              <span className={styles.planEyebrow}>BƯỚC 2 / 4</span>
              <h2>Tìm bài</h2>
              <p className={styles.note}>Tìm theo kế hoạch đã duyệt hoặc mở rộng từ các bài đã chọn.</p>
            </div>
            <Badge tone={approved ? 'success' : 'warning'}>
              {approved ? 'Kế hoạch đã duyệt' : 'Cần duyệt kế hoạch'}
            </Badge>
          </header>
          <div className={styles.findLayout}>
            <section className={styles.findActions} aria-label="Thao tác tìm bài">
              <div>
                <h3>Chạy tìm kiếm</h3>
                <p className={styles.note}>
                  Truy vấn và khoảng năm được gửi tới OpenAlex. Bài trùng theo DOI hoặc tên và năm chỉ giữ một
                  lần.
                </p>
              </div>
              <div className={styles.actions}>
                <Button variant="primary" disabled={!approved || Boolean(busy)} onClick={() => void search()}>
                  Tìm theo kế hoạch
                </Button>
                <Button disabled={!count('included') || Boolean(busy)} onClick={() => void expand()}>
                  Mở rộng theo trích dẫn
                </Button>
              </div>
              {!approved && (
                <p className={styles.stepHint}>
                  Duyệt kế hoạch trước khi tìm.{' '}
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.stepLink}
                    onClick={() => selectStep('plan')}
                  >
                    Mở kế hoạch
                  </Button>
                </p>
              )}
            </section>
            <aside className={styles.stepAside} aria-label="Phạm vi tìm kiếm">
              <span className={styles.planEyebrow}>PHẠM VI TÌM KIẾM</span>
              <dl className={styles.planStats}>
                <div>
                  <dt>Nguồn</dt>
                  <dd>OpenAlex</dd>
                </div>
                <div>
                  <dt>Truy vấn</dt>
                  <dd>{plan?.queries.length ?? 0}</dd>
                </div>
                <div>
                  <dt>Khoảng năm</dt>
                  <dd>
                    {plan?.fromYear ?? 'Không giới hạn'} – {plan?.toYear ?? 'hiện tại'}
                  </dd>
                </div>
                <div>
                  <dt>Lượt tìm đã chạy</dt>
                  <dd>{deep.rounds.length}</dd>
                </div>
              </dl>
            </aside>
          </div>
          {deep.rounds.length > 0 && (
            <details className={styles.searchHistory}>
              <summary>Nhật ký tìm ({deep.rounds.length} lượt)</summary>
              <ul className={styles.history}>
                {deep.rounds.map((item) => (
                  <li key={item.id}>
                    {item.kind === 'query'
                      ? 'Truy vấn'
                      : item.kind === 'cites'
                        ? 'Bài trích dẫn'
                        : 'Bài được trích'}
                    : {item.input} · {item.found} tìm thấy · {item.added} mới
                    {item.note ? ` · ${item.note}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      )}

      {activeStep === 'screen' && (
        <Card className={styles.stepContent}>
          <h2>Sàng lọc</h2>
          <div className={styles.chips}>
            <Chip
              aria-pressed={filter === 'all'}
              count={deep.candidates.length}
              onClick={() => setFilter('all')}
            >
              Tất cả
            </Chip>
            {(Object.keys(SCREEN) as ScreeningStatus[]).map((status) => (
              <Chip
                key={status}
                aria-pressed={filter === status}
                count={count(status)}
                onClick={() => setFilter(status)}
              >
                {SCREEN[status].label}
              </Chip>
            ))}
          </div>
          <div className={styles.actions}>
            <Button
              disabled={!estimate.papers || !(plan || question.trim()) || Boolean(busy)}
              onClick={() => void screen()}
            >
              Gợi ý sàng lọc (AI) · {estimate.calls} lượt gọi
            </Button>
            <Button
              variant="primary"
              disabled={!incoming.length || Boolean(busy)}
              onClick={() => void bring()}
            >
              Đưa {incoming.length} bài đã chọn vào ma trận
            </Button>
          </div>
          {estimate.papers > 0 && (
            <p className={styles.note}>
              {estimate.papers} bài chưa được chấm điểm · khoảng {estimate.tokens.toLocaleString('vi-VN')}{' '}
              token
              {criteria.length
                ? ` · chấm theo ${criteria.length} tiêu chí`
                : ' · chưa có tiêu chí, chấm theo research question'}
              . Dừng giữa chừng vẫn giữ các lô đã chấm; chạy lại sẽ tiếp tục từ bài chưa chấm.
            </p>
          )}
          <TriagePanel
            buckets={buckets}
            borderline={borderline}
            thresholds={thresholds}
            onThresholds={setThresholds}
            filter={aiFilter}
            onFilter={setAiFilter}
            sort={sort}
            onSort={setSort}
            disabled={Boolean(busy)}
            onApply={accept}
          />
          {!deep.candidates.length ? (
            <Empty title="Chưa có bài ứng viên." hint="Duyệt kế hoạch ở bước 1 rồi bấm Tìm theo kế hoạch." />
          ) : (
            <ul className={styles.candidates}>
              {shown.map((item) => (
                <li key={item.key} className={styles.candidate}>
                  <details className={styles.candidateDetails}>
                    <summary className={styles.candidateSummary}>
                      <span className={styles.paperTitle}>{item.title}</span>
                      <span className={styles.candidateMeta}>
                        {item.year ?? 'Năm chưa rõ'} · {SCREEN[item.status].label}
                      </span>
                    </summary>
                    <div className={styles.candidateBody}>
                      <div className={styles.badges}>
                        <Badge tone={SCREEN[item.status].tone}>{SCREEN[item.status].label}</Badge>
                        {item.suggestion && item.status === 'candidate' && (
                          <Badge tone="accent">
                            AI gợi ý: {BUCKET_LABEL[bucketOf(item, thresholds) ?? item.suggestion.decision]}
                          </Badge>
                        )}
                        {item.decidedBy === 'ai_accepted' && item.status !== 'candidate' && (
                          <Badge>Theo đề xuất AI</Badge>
                        )}
                        {existing.has(`search:${item.key}`) && <Badge>Trong ma trận</Badge>}
                      </div>
                      <span className={styles.note}>
                        {[
                          item.year,
                          item.venue,
                          item.authors.slice(0, 3).join(', '),
                          item.citedBy !== null && `${item.citedBy} trích dẫn`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {(item.reason ?? item.suggestion?.reason) && (
                        <span className={styles.note}>
                          {item.reason ? 'Lý do' : 'Lý do AI gợi ý'}: {item.reason ?? item.suggestion?.reason}
                        </span>
                      )}
                      <TriageDetails
                        candidate={item}
                        thresholds={thresholds}
                        criteria={criteria}
                        flagged={borderline.includes(item.key)}
                        disabled={Boolean(busy)}
                        onAccept={(bucket) => accept(bucket, [item.key])}
                      />
                      {item.abstract ? (
                        <details>
                          <summary>Abstract</summary>
                          <p>{item.abstract}</p>
                        </details>
                      ) : (
                        <span className={styles.note}>Không có abstract trên OpenAlex.</span>
                      )}
                      <div className={styles.actions}>
                        {(['included', 'excluded', 'uncertain'] as const).map((status) => (
                          <Button
                            key={status}
                            size="sm"
                            variant={item.status === status ? 'primary' : 'secondary'}
                            aria-pressed={item.status === status}
                            onClick={() => decide(item, item.status === status ? 'candidate' : status)}
                          >
                            {SCREEN[status].label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {activeStep === 'synthesis' && (
        <Card className={`${styles.stepContent} ${styles.synthesisStep}`}>
          <header className={styles.stepHeader}>
            <div>
              <span className={styles.planEyebrow}>BƯỚC 4 / 4</span>
              <h2>Tổng hợp liên bài</h2>
              <p className={styles.note}>Tạo các chủ đề và kết luận có dẫn chứng từ dữ liệu trong ma trận.</p>
            </div>
            {latest && <Badge tone="success">Đã có bản tổng hợp</Badge>}
          </header>
          <div className={styles.synthesisLaunch}>
            <section className={styles.synthesisPrompt} aria-label="Điều kiện tổng hợp">
              <div className={styles.readinessValue}>
                <strong>{ready}</strong>
                <span>bài có giá trị trong ma trận</span>
              </div>
              <p className={styles.note}>
                {ready >= 2
                  ? 'Đủ dữ liệu để tổng hợp. Ô mâu thuẫn và ô bị giữ lại sẽ được loại khỏi đầu vào.'
                  : `Cần ít nhất 2 bài có giá trị; còn thiếu ${2 - ready}. Ô mâu thuẫn và ô bị giữ lại không được tính.`}
              </p>
            </section>
            <div className={styles.synthesisActions}>
              <Button
                variant="primary"
                disabled={ready < 2 || Boolean(busy)}
                onClick={() => void synthesize()}
              >
                Tổng hợp (AI) · 1 lượt gọi
              </Button>
              {latest && (
                <Button
                  onClick={() =>
                    downloadText(
                      `synthesis-${project.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}.md`,
                      synthesisMarkdown(project, latest),
                      'text/markdown;charset=utf-8',
                    )
                  }
                >
                  Xuất Markdown
                </Button>
              )}
              <span className={styles.note}>Nên chạy High Quality trước khi tổng hợp.</span>
            </div>
          </div>
          {latest && (
            <div className={styles.synthesis}>
              <p className={styles.note}>
                {new Date(latest.createdAt).toLocaleString('vi-VN')} · {latest.model} · {latest.promptVersion}
                {latest.droppedRefs > 0 &&
                  ` · bỏ ${latest.droppedRefs} trích dẫn tới bài không có trong ma trận`}
              </p>
              {(Object.keys(CLAIM_TITLES) as (keyof typeof CLAIM_TITLES)[]).map((kind) => {
                const claims = latest.claims.filter((claim) => claim.kind === kind);
                if (!claims.length) return null;
                return (
                  <section key={kind}>
                    <h3>{CLAIM_TITLES[kind]}</h3>
                    <ul className={styles.list}>
                      {claims.map((claim, index) => (
                        <li key={index}>
                          <p>
                            {claim.text}{' '}
                            {!claim.supported && <Badge tone="warning">Chưa có nguồn trong ma trận</Badge>}
                            {hasGrounding &&
                              claim.supported &&
                              claim.kind !== 'gap' &&
                              !isGrounded(claim) && (
                                <Badge tone="warning">Chưa có đoạn trích kiểm chứng</Badge>
                              )}
                          </p>
                          {claim.citations.length > 0 && (
                            <span className={styles.badges}>
                              {claim.citations.map((citation) => (
                                <Chip
                                  key={`${citation.paperKey}:${citation.fieldKey}`}
                                  title={citation.quotes[0]?.quote ?? 'Không có đoạn trích'}
                                  aria-label={`Trích dẫn ${numberOf(citation.paperKey)}: ${titleOf(citation.paperKey)} · ${citation.fieldLabel}`}
                                  onClick={() =>
                                    setGrounding({ kind: 'citation', citation, claim: claim.text })
                                  }
                                >
                                  [{numberOf(citation.paperKey)}] {citation.fieldLabel} ·{' '}
                                  {!citation.quotes.length
                                    ? 'không có đoạn trích'
                                    : citation.fullText
                                      ? 'toàn văn'
                                      : 'abstract'}
                                </Chip>
                              ))}
                            </span>
                          )}
                          {claim.paperKeys.some(
                            (key) => !claim.citations.some((citation) => citation.paperKey === key),
                          ) && (
                            <span className={styles.note}>
                              Chỉ nêu title:{' '}
                              {claim.paperKeys
                                .filter(
                                  (key) => !claim.citations.some((citation) => citation.paperKey === key),
                                )
                                .map(titleOf)
                                .join('; ')}
                            </span>
                          )}
                          {claim.caveat && <span className={styles.note}>Lưu ý: {claim.caveat}</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              <p className={styles.note}>
                Cần kiểm tra research gap như một hypothesis, không phải kết luận rằng chưa ai nghiên cứu.
              </p>
              {latest.paperKeys.length > 0 && (
                <section>
                  <h3>Tài liệu và đoạn trích</h3>
                  {!hasGrounding && (
                    <p className={styles.note}>
                      Bản tổng hợp này tạo trước khi có đối chiếu trích dẫn. Chạy lại tổng hợp để xem đoạn
                      trích đứng sau từng claim.
                    </p>
                  )}
                  <ol className={styles.references}>
                    {latest.paperKeys.map((key) => {
                      const quotes = paperEvidence(latest, key).reduce(
                        (total, item) => total + item.citation.quotes.length,
                        0,
                      );
                      return (
                        <li key={key}>
                          {titleOf(key)}{' '}
                          {hasGrounding && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setGrounding({ kind: 'paper', paperKey: key })}
                            >
                              {quotes} đoạn trích
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}
            </div>
          )}
        </Card>
      )}
      {grounding && latest && (
        <GroundingDrawer
          project={project}
          synthesis={latest}
          target={grounding}
          onClose={() => setGrounding(null)}
        />
      )}
    </div>
  );
}
import type { ExtractionEvent } from '@/shared/storage/extractionProjects';
