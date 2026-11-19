import { useEffect, useRef, useState } from 'react';
import {
  SCREENING_REASON_CODES,
  latestDecision,
  recordDecision,
  suggestionFor,
  type AiSuggestion,
  type ScreeningDecision,
  type ScreeningReasonCode,
  type ScreeningStage,
} from '@/core/corpus/screening';
import {
  acceptCorpusTriage,
  corpusCriteria,
  corpusPlan,
  corpusQuestion,
  storeTriage,
  triageView,
} from '@/core/corpus/triage';
import {
  borderlineSample,
  bucketOf,
  DEFAULT_THRESHOLDS,
  estimateTriage,
  sortByScore,
  triageBuckets,
  type Thresholds,
  type TriageBucket,
  type TriageSort,
} from '@/core/extraction';
import type { Corpus } from '@/core/schemas';
import { TriageDetails, TriagePanel, type TriageFilter } from '@/modules/extraction';
import { describeLlmError } from '@/shared/llm/describeError';
import { useLlm } from '@/shared/llm/LlmProvider';
import { llmTriage } from '@/shared/llm/llmDeepResearch';
import { Button } from '@/shared/ui/Button';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { decisionErrors, decisionLabels, reasonLabels, stageLabels } from './labels';
import styles from './corpus.module.css';

/**
 * Two-stage screening: every click appends a person decision; AI suggestions are shown apart until accepted.
 * The AI triage (scores, buckets, bulk apply) is the Project's, run on the stage's members.
 */
export function ScreeningList({ corpus, save }: { corpus: Corpus; save: (value: Corpus) => Promise<void> }) {
  const llm = useLlm();
  const [stage, setStage] = useState<ScreeningStage>('title-abstract');
  const [name, setName] = useState('');
  const [reasonCode, setReasonCode] = useState<ScreeningReasonCode | ''>('');
  const [reasonText, setReasonText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [aiFilter, setAiFilter] = useState<TriageFilter>('all');
  const [sort, setSort] = useState<TriageSort>('default');
  const controller = useRef<AbortController | null>(null);
  /** The latest corpus, so a checkpoint saved mid-run merges onto decisions made meanwhile. */
  const current = useRef(corpus);
  useEffect(() => {
    current.current = corpus;
  }, [corpus]);

  const view = triageView(corpus, stage);
  const members = new Map(corpus.members.map((member) => [member.memberId, member]));
  const criteria = corpusCriteria(corpus);
  const question = corpusQuestion(corpus);
  const estimate = estimateTriage(view);
  const buckets = triageBuckets(view, thresholds);
  const borderline = borderlineSample(view, thresholds);
  const shown = sortByScore(
    view.filter(
      (item) =>
        aiFilter === 'all' ||
        (aiFilter === 'check'
          ? borderline.includes(item.key)
          : item.status === 'candidate' && bucketOf(item, thresholds) === aiFilter),
    ),
    sort,
  );

  function decide(memberId: string, decision: ScreeningDecision, acceptedSuggestion?: AiSuggestion) {
    const result = recordDecision(
      current.current,
      memberId,
      { stage, decision, reasonCode, reasonText, person: name, acceptedSuggestion },
      new Date().toISOString(),
    );
    if (!result.ok) {
      setError(decisionErrors[result.error]);
      return;
    }
    setError('');
    // The log is append-only, so a reason must not carry over to the next paper by accident.
    setReasonCode('');
    setReasonText('');
    commit(result.corpus);
  }
  /** Saves a decision; the ref moves first, so a triage checkpoint landing before the re-render keeps it. */
  function commit(next: Corpus) {
    current.current = next;
    void save(next).catch((cause: unknown) => setError(String(cause)));
  }
  /** Applies the AI bucket as the person's decisions; for many members only after the panel's confirmation. */
  function accept(bucket: TriageBucket, keys: string[]) {
    const result = acceptCorpusTriage(
      current.current,
      stage,
      keys,
      bucket,
      thresholds,
      { person: name, reasonCode, reasonText },
      new Date().toISOString(),
    );
    if (!result.ok) {
      setError(decisionErrors[result.error]);
      return;
    }
    setError('');
    if (!result.applied) return;
    setReasonCode('');
    setReasonText('');
    commit(result.corpus);
  }
  async function triage() {
    const abort = new AbortController();
    controller.current = abort;
    const runStage = stage;
    setBusy('Đang chấm điểm sàng lọc…');
    setError('');
    try {
      if (!(await llm.ensureConsent('paper')) || abort.signal.aborted) return;
      const start = current.current;
      await llmTriage(llm.client, question, corpusPlan(start), triageView(start, runStage), {
        config: llm.config,
        signal: abort.signal,
        // A checkpoint per batch: a stop or a failure keeps every batch already graded.
        onBatch: async ({ apply, index, total }) => {
          const base = current.current;
          const before = triageView(base, runStage);
          const next = storeTriage(base, runStage, before, apply(before), new Date().toISOString());
          current.current = next;
          setBusy(`Đang chấm điểm sàng lọc… lô ${index + 1}/${total}`);
          await save(next);
        },
      });
    } catch (cause) {
      if (!abort.signal.aborted) setError(describeLlmError(cause) ?? String(cause));
    } finally {
      setBusy('');
      controller.current = null;
    }
  }

  return (
    <section aria-labelledby="corpus-screening">
      <h3 id="corpus-screening">Sàng lọc</h3>
      <div className={styles.row}>
        <TextField label="Người quyết định" value={name} onChange={(event) => setName(event.target.value)} />
        <Select
          label="Giai đoạn"
          value={stage}
          disabled={Boolean(busy)}
          onChange={(event) => setStage(event.target.value as ScreeningStage)}
        >
          <option value="title-abstract">{stageLabels['title-abstract']}</option>
          <option value="full-text">{stageLabels['full-text']}</option>
        </Select>
        <Select
          label="Lý do loại"
          value={reasonCode}
          onChange={(event) => setReasonCode(event.target.value as ScreeningReasonCode | '')}
        >
          <option value="">Chọn lý do</option>
          {SCREENING_REASON_CODES.map((code) => (
            <option key={code} value={code}>
              {reasonLabels[code]}
            </option>
          ))}
        </Select>
        <TextField
          label="Ghi chú lý do"
          hint={reasonCode === 'other' ? 'Bắt buộc với lý do khác' : 'Không bắt buộc'}
          value={reasonText}
          onChange={(event) => setReasonText(event.target.value)}
        />
      </div>
      <div className={styles.cardTools}>
        <Button disabled={!estimate.papers || Boolean(busy)} onClick={() => void triage()}>
          Gợi ý sàng lọc (AI) · {estimate.calls} lượt gọi
        </Button>
        {busy && (
          <Button variant="danger" onClick={() => controller.current?.abort()}>
            Dừng
          </Button>
        )}
        {busy && <span role="status">{busy}</span>}
      </div>
      {estimate.papers > 0 && (
        <p className={styles.muted}>
          {estimate.papers} bài chưa quyết định chưa được chấm điểm · khoảng{' '}
          {estimate.tokens.toLocaleString('vi-VN')} token
          {criteria.length
            ? ` · chấm theo ${criteria.length} tiêu chí của protocol`
            : ' · protocol chưa có tiêu chí, chấm theo research question'}
          . Dừng giữa chừng vẫn giữ các lô đã chấm; chạy lại sẽ tiếp tục từ bài chưa chấm.
        </p>
      )}
      {stage === 'full-text' && (
        <p className={styles.muted}>
          Ở bước toàn văn, AI vẫn chỉ đọc title, abstract và metadata, không đọc toàn văn. Quyết định cuối là
          của bạn.
        </p>
      )}
      <p className={styles.muted}>
        Áp dụng hàng loạt ghi quyết định dưới tên người quyết định ở trên; với Loại cần chọn lý do loại trước.
      </p>
      {error && <p role="alert">{error}</p>}
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
      {stage === 'full-text' && view.length === 0 && (
        <p className={styles.muted}>Chưa có bài nào được chọn ở bước title và abstract.</p>
      )}
      <ul className={styles.list}>
        {shown.map((item) => {
          const member = members.get(item.key);
          if (!member) return null;
          const current = latestDecision(member, stage);
          const triaged = bucketOf(item, thresholds) !== null;
          const suggestion = triaged ? undefined : suggestionFor(corpus, member, stage);
          const label = item.title;
          return (
            <li key={member.memberId} className={styles.screenItem}>
              <span className={styles.memberTitle}>{label}</span>
              <span className={styles.muted}>
                {current
                  ? `${decisionLabels[current.decision]}${current.decision === 'exclude' && current.reasonCode in reasonLabels ? ` — ${reasonLabels[current.reasonCode as ScreeningReasonCode]}` : ''}${current.acceptedSuggestion ? ' · theo đề xuất AI' : ''}`
                  : 'Chưa quyết định'}
              </span>
              {triaged && (
                <div className={styles.suggestion}>
                  <span>AI gợi ý: {item.suggestion?.reason}</span>
                  <TriageDetails
                    candidate={item}
                    thresholds={thresholds}
                    criteria={criteria}
                    flagged={borderline.includes(item.key)}
                    disabled={Boolean(busy)}
                    onAccept={(bucket) => accept(bucket, [item.key])}
                  />
                </div>
              )}
              {suggestion && (
                <span className={styles.suggestion}>
                  AI gợi ý: {decisionLabels[suggestion.decision]} — {suggestion.reason}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => decide(member.memberId, suggestion.decision, suggestion)}
                  >
                    Chấp nhận gợi ý
                  </Button>
                </span>
              )}
              <span className={styles.cardTools} role="group" aria-label={`Quyết định cho ${label}`}>
                {(['include', 'exclude', 'uncertain'] as const).map((decision) => (
                  <Button key={decision} size="sm" onClick={() => decide(member.memberId, decision)}>
                    {decisionLabels[decision]}
                  </Button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
