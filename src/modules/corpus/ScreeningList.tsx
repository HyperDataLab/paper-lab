import { useState } from 'react';
import {
  SCREENING_REASON_CODES,
  canScreenFullText,
  latestDecision,
  recordDecision,
  suggestionFor,
  type AiSuggestion,
  type ScreeningDecision,
  type ScreeningReasonCode,
  type ScreeningStage,
} from '@/core/corpus/screening';
import type { Corpus } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { decisionErrors, decisionLabels, reasonLabels, stageLabels } from './labels';
import styles from './corpus.module.css';

/** Two-stage screening: every click appends a person decision; AI suggestions are shown apart until accepted. */
export function ScreeningList({ corpus, save }: { corpus: Corpus; save: (value: Corpus) => Promise<void> }) {
  const [stage, setStage] = useState<ScreeningStage>('title-abstract');
  const [name, setName] = useState('');
  const [reasonCode, setReasonCode] = useState<ScreeningReasonCode | ''>('');
  const [reasonText, setReasonText] = useState('');
  const [error, setError] = useState('');
  const members =
    stage === 'full-text' ? corpus.members.filter((member) => canScreenFullText(member)) : corpus.members;
  function decide(memberId: string, decision: ScreeningDecision, acceptedSuggestion?: AiSuggestion) {
    const result = recordDecision(
      corpus,
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
    void save(result.corpus).catch((cause: unknown) => setError(String(cause)));
  }
  return (
    <section aria-labelledby="corpus-screening">
      <h3 id="corpus-screening">Sàng lọc</h3>
      <div className={styles.row}>
        <TextField label="Người quyết định" value={name} onChange={(event) => setName(event.target.value)} />
        <Select
          label="Giai đoạn"
          value={stage}
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
      {error && <p role="alert">{error}</p>}
      {stage === 'full-text' && members.length === 0 && (
        <p className={styles.muted}>Chưa có bài nào được chọn ở bước tiêu đề và tóm tắt.</p>
      )}
      <ul className={styles.list}>
        {members.map((member) => {
          const current = latestDecision(member, stage);
          const suggestion = stage === 'title-abstract' ? suggestionFor(corpus, member) : undefined;
          const label = member.title ?? member.identifiers.doi ?? member.exportId;
          return (
            <li key={member.memberId} className={styles.screenItem}>
              <span className={styles.memberTitle}>{label}</span>
              <span className={styles.muted}>
                {current
                  ? `${decisionLabels[current.decision]}${current.decision === 'exclude' && current.reasonCode in reasonLabels ? ` — ${reasonLabels[current.reasonCode as ScreeningReasonCode]}` : ''}`
                  : 'Chưa quyết định'}
              </span>
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
