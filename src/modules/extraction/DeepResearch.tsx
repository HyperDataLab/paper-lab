import { Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  addPapers,
  candidateFromWork,
  decideCandidate,
  emptyDeep,
  isGrounded,
  mergeCandidates,
  paperEvidence,
  papersFromCandidates,
  SCREENING_BATCH,
  synthesisInput,
  synthesisMarkdown,
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
import { llmScreening, llmSearchPlan, llmSynthesis } from '@/shared/llm/llmDeepResearch';
import { createScholarClient } from '@/shared/scholar/client';
import { ActionBar } from '@/shared/ui/ActionBar';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Chip } from '@/shared/ui/Chip';
import { TextField } from '@/shared/ui/TextField';
import { GroundingDrawer, type GroundingTarget } from './GroundingDrawer';
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
}: {
  project: ExtractionProject;
  onSave: Save;
  /** Shows the papers once they are in the project, where a view of them exists. */
  onOpenMatrix?: () => void;
}) {
  const llm = useLlm();
  const deep = project.deep ?? emptyDeep();
  const [question, setQuestion] = useState(project.researchQuestion);
  const [draft, setDraft] = useState(() => draftOf(deep.plan));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<ScreeningStatus | 'all'>('all');
  const [grounding, setGrounding] = useState<GroundingTarget | null>(null);
  const controller = useRef<AbortController | null>(null);
  const plan = deep.plan;
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
      setDraft(draftOf(next));
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
  const pending = deep.candidates.filter((item) => item.status === 'candidate' && !item.suggestion);
  const screen = () =>
    task('Đang gợi ý sàng lọc…', async (signal) => {
      if (!plan || !(await ai(signal))) return;
      const candidates = await llmScreening(llm.client, question.trim(), plan, deep.candidates, {
        config: llm.config,
        signal,
      });
      await onSave(withDeep({ candidates }), { action: 'run_extraction', after: { step: 'screening' } });
    });
  const decide = (candidate: Candidate, status: ScreeningStatus) =>
    void onSave(
      withDeep({
        candidates: decideCandidate(deep.candidates, candidate.key, status, new Date().toISOString()),
      }),
      { action: 'review_extraction', after: { step: 'screen', key: candidate.key, status } },
    );
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
  const shown = deep.candidates.filter((item) => filter === 'all' || item.status === filter);
  const count = (status: ScreeningStatus) => deep.candidates.filter((item) => item.status === status).length;

  return (
    <div className={styles.deep}>
      <ActionBar
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

      <Card>
        <h2>Kế hoạch tìm kiếm</h2>
        <div className={styles.inlineField}>
          <TextField
            label="Research question"
            multiline
            rows={2}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <Button
            leadingIcon={<Sparkles size={16} aria-hidden="true" />}
            disabled={Boolean(busy) || !question.trim()}
            onClick={() => void proposePlan()}
          >
            Đề xuất kế hoạch (AI)
          </Button>
        </div>
        <TextField
          label="Truy vấn (mỗi dòng một truy vấn, tối đa 8)"
          multiline
          rows={4}
          value={draft.queries}
          onChange={(event) => setDraft({ ...draft, queries: event.target.value })}
        />
        <div className={styles.twoCols}>
          <TextField
            label="Tiêu chí chọn (mỗi dòng một tiêu chí)"
            multiline
            rows={3}
            value={draft.inclusion}
            onChange={(event) => setDraft({ ...draft, inclusion: event.target.value })}
          />
          <TextField
            label="Tiêu chí loại"
            multiline
            rows={3}
            value={draft.exclusion}
            onChange={(event) => setDraft({ ...draft, exclusion: event.target.value })}
          />
          <TextField
            label="Từ năm"
            inputMode="numeric"
            value={draft.fromYear}
            onChange={(event) => setDraft({ ...draft, fromYear: event.target.value })}
          />
          <TextField
            label="Đến năm"
            inputMode="numeric"
            value={draft.toYear}
            onChange={(event) => setDraft({ ...draft, toYear: event.target.value })}
          />
        </div>
        <div className={styles.actions}>
          <Button variant="primary" disabled={approved || !lines(draft.queries).length} onClick={approvePlan}>
            {approved ? 'Đã duyệt' : 'Duyệt kế hoạch'}
          </Button>
          {plan?.approvedAt && dirty && <Badge tone="warning">Đã sửa, cần duyệt lại</Badge>}
        </div>
      </Card>

      <Card>
        <h2>Tìm bài</h2>
        <p className={styles.note}>
          Chỉ truy vấn và khoảng năm được gửi tới OpenAlex. Bài trùng (theo DOI, hoặc tên và năm) chỉ giữ một
          lần.
        </p>
        <div className={styles.actions}>
          <Button variant="primary" disabled={!approved || Boolean(busy)} onClick={() => void search()}>
            Tìm theo kế hoạch
          </Button>
          <Button disabled={!count('included') || Boolean(busy)} onClick={() => void expand()}>
            Mở rộng theo trích dẫn
          </Button>
        </div>
        {!approved && <p className={styles.note}>Duyệt kế hoạch trước khi tìm.</p>}
        {deep.rounds.length > 0 && (
          <details>
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

      <Card>
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
          <Button disabled={!pending.length || !plan || Boolean(busy)} onClick={() => void screen()}>
            Gợi ý sàng lọc (AI) · {Math.ceil(pending.length / SCREENING_BATCH)} lượt gọi
          </Button>
          <Button variant="primary" disabled={!incoming.length || Boolean(busy)} onClick={() => void bring()}>
            Đưa {incoming.length} bài đã chọn vào ma trận
          </Button>
        </div>
        {!deep.candidates.length ? (
          <Empty title="Chưa có bài ứng viên." hint="Duyệt kế hoạch ở bước 1 rồi bấm Tìm theo kế hoạch." />
        ) : (
          <ul className={styles.candidates}>
            {shown.map((item) => (
              <li key={item.key} className={styles.candidate}>
                <div className={styles.badges}>
                  <Badge tone={SCREEN[item.status].tone}>{SCREEN[item.status].label}</Badge>
                  {item.suggestion && item.status === 'candidate' && (
                    <Badge tone="accent">AI gợi ý: {SCREEN[item.suggestion.decision].label}</Badge>
                  )}
                  {existing.has(`search:${item.key}`) && <Badge>Trong ma trận</Badge>}
                </div>
                <span className={styles.paperTitle}>{item.title}</span>
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
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2>Tổng hợp liên bài</h2>
        <p className={styles.note}>
          Chỉ dùng giá trị đang hiện trong ma trận ({ready} bài có giá trị); ô mâu thuẫn và ô bị giữ lại không
          được đưa vào. Nên chạy High Quality trước.
        </p>
        <div className={styles.actions}>
          <Button variant="primary" disabled={ready < 2 || Boolean(busy)} onClick={() => void synthesize()}>
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
        </div>
        {ready < 2 && <p className={styles.note}>Cần ít nhất 2 bài có giá trị trong ma trận.</p>}
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
                          {hasGrounding && claim.supported && claim.kind !== 'gap' && !isGrounded(claim) && (
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
                              .filter((key) => !claim.citations.some((citation) => citation.paperKey === key))
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
                    Bản tổng hợp này tạo trước khi có đối chiếu trích dẫn. Chạy lại tổng hợp để xem đoạn trích
                    đứng sau từng nhận định.
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
