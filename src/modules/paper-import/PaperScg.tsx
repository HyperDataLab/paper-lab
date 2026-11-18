import { useEffect, useMemo, useRef, useState } from 'react';
import { buildPaperModel } from '@/core/paperModel';
import { paperDoi } from '@/core/scholarlyContext';
import type { ScgReviewTarget } from '@/core/scg';
import { scgCallBound } from '@/core/scg/pass';
import {
  SCG_CONTRIBUTION_TYPES,
  type Paper,
  type ScgPaperRun,
  type ScgReference,
  type ScgReview,
  type ScgStage,
} from '@/core/schemas';
import { describeLlmError } from '@/shared/llm/describeError';
import { useLlm } from '@/shared/llm/LlmProvider';
import { llmScg } from '@/shared/llm/llmScg';
import { createScholarClient } from '@/shared/scholar/client';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { FindingCard, ReviewActions } from '@/shared/ui/FindingCard';
import styles from './scg.module.css';

const STAGES: Record<ScgStage, string> = {
  contributions: 'Giai đoạn 1/3: trích đóng góp',
  prerequisites: 'Giai đoạn 2/3: tìm nền tảng (prerequisite)',
  alignment: 'Giai đoạn 3/3: nối với đóng góp của các bài khác',
  complete: 'Đã xong',
};
const cardState = (review: ScgReview) =>
  review === 'accepted' ? 'confirmed' : review === 'rejected' ? 'dismissed' : 'open';
const stateWord = (review: ScgReview) =>
  review === 'accepted' ? 'Đã chấp nhận' : review === 'rejected' ? 'Đã bác bỏ' : 'Ứng viên';

function referenceText(reference: ScgReference) {
  if (reference.kind === 'contribution') return `Đóng góp ${reference.contributionId} của bài này`;
  if (reference.kind === 'tool') return reference.url;
  return [reference.title, reference.year, reference.doi && `doi:${reference.doi}`]
    .filter(Boolean)
    .join(' · ');
}

/** SCG contributions of one paper with their prerequisites; every item is a candidate until accepted. */
export function PaperScg({
  paper,
  onLocation,
}: {
  paper: Paper;
  onLocation: (location: { paragraphId: string; start: number; end: number }) => void;
}) {
  const repo = useRepositories();
  const llm = useLlm();
  const [run, setRun] = useState<ScgPaperRun>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const model = useMemo(() => buildPaperModel({ paper, metadata: null, now: new Date() }), [paper]);
  const sentences = useMemo(() => new Map(model.sentences.map((s) => [s.key, s])), [model]);
  useEffect(() => {
    void repo.scg.get(paper.id).then(setRun);
  }, [paper.id, repo]);

  async function start() {
    setError('');
    setRunning(true);
    controller.current = new AbortController();
    try {
      if (!(await llm.ensureConsent('paper'))) return;
      const context = await repo.paperContext.get(paper.id);
      const doi = context?.metadata?.doi ?? context?.paperDoi ?? paperDoi(paper) ?? null;
      const previous = await repo.scg.get(paper.id);
      const others = (await repo.scg.list()).filter((other) => other.paperId !== paper.id);
      const scholar = createScholarClient({});
      const result = await llmScg(llm.client, model, {
        paperId: paper.id,
        doi,
        config: llm.config,
        previous,
        others,
        lookupS2CorpusId: scholar.lookupS2CorpusId,
        signal: controller.current.signal,
        onProgress: async (checkpoint) => {
          setRun(await repo.scg.save(checkpoint));
        },
      });
      setRun(await repo.scg.save(result));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError')
        setError('Đã dừng. Chạy lại để tiếp tục.');
      else setError(describeLlmError(cause) ?? String(cause));
    } finally {
      controller.current = null;
      setRunning(false);
    }
  }
  async function review(target: ScgReviewTarget, value: ScgReview) {
    const saved = await repo.scg.setReview(paper.id, target, value);
    if (saved) setRun(saved);
  }
  function quotes(keys: string[]) {
    return keys
      .map((key) => sentences.get(key)?.text ?? '')
      .filter(Boolean)
      .join(' … ');
  }
  function source(keys: string[]) {
    const first = sentences.get(keys[0] ?? '');
    return first
      ? {
          label: 'Xem trong bài',
          onOpen: () => onLocation({ paragraphId: first.paragraphId, start: first.start, end: first.end }),
        }
      : undefined;
  }
  const unfinished = run && run.status !== 'complete';
  return (
    <section aria-label="Scientific Contribution Graph" className={styles.scg}>
      <h2>Scientific Contribution Graph</h2>
      <p className={styles.muted}>
        Mỗi đóng góp của bài, các nền tảng nó dựa vào, và chỗ nối với đóng góp của các bài khác trong thư
        viện. Kết quả là ứng viên cho tới khi bạn chấp nhận.
      </p>
      <div className={styles.toolbar}>
        <Button variant="primary" disabled={running || !model.sentences.length} onClick={() => void start()}>
          {running ? 'Đang trích…' : 'Trích đóng góp (SCG)'}
        </Button>
        {running && <Button onClick={() => controller.current?.abort()}>Dừng</Button>}
        <span className={styles.muted}>Tối đa {scgCallBound(model.sentences)} lượt gọi AI.</span>
      </div>
      {run && (
        <p className={styles.muted} aria-live="polite">
          {STAGES[run.status]} · {run.callsUsed} lượt gọi AI
          {unfinished && !running && ' · lần chạy trước chưa xong, bấm để tiếp tục'}
          {run.s2CorpusId && ` · Semantic Scholar ${run.s2CorpusId}`}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {run && run.dropped.quotes + run.dropped.contributions + run.dropped.prerequisites > 0 && (
        <p className={styles.muted}>
          Đã bỏ {run.dropped.quotes} trích dẫn không có trong bài, {run.dropped.contributions} đóng góp và{' '}
          {run.dropped.prerequisites} nền tảng không kiểm chứng được.
        </p>
      )}
      {run?.status === 'complete' && !run.contributions.length && <p>Không tìm thấy đóng góp nào.</p>}
      <div className={styles.list}>
        {run?.contributions.map((contribution) => (
          <FindingCard
            key={contribution.id}
            state={cardState(contribution.review)}
            labels={
              <>
                <strong>{contribution.name}</strong>
                {contribution.types.map((t) => (
                  <span key={t.type} title={t.explanation || SCG_CONTRIBUTION_TYPES[t.type]}>
                    <Badge tone="accent">{t.type}</Badge>
                  </span>
                ))}
                <Badge>{stateWord(contribution.review)}</Badge>
              </>
            }
            quote={quotes(contribution.sourceSentenceKeys)}
            source={source(contribution.sourceSentenceKeys)}
            actions={
              <ReviewActions
                decided={contribution.review !== 'candidate'}
                confirmLabel="Chấp nhận"
                dismissLabel="Bác bỏ"
                onConfirm={() => void review({ contributionId: contribution.id }, 'accepted')}
                onDismiss={() => void review({ contributionId: contribution.id }, 'rejected')}
                onUndo={() => void review({ contributionId: contribution.id }, 'candidate')}
              />
            }
          >
            <p>{contribution.description}</p>
            <p className={styles.muted}>
              {contribution.id}
              {contribution.sections.length > 0 && ` · Mục: ${contribution.sections.join(', ')}`}
            </p>
            {contribution.prerequisites.length > 0 && (
              <div className={styles.prerequisites}>
                <h4>Dựa trên</h4>
                {contribution.prerequisites.map((prerequisite) => {
                  const target = { contributionId: contribution.id, prerequisiteId: prerequisite.id };
                  return (
                    <FindingCard
                      key={prerequisite.id}
                      state={cardState(prerequisite.review)}
                      labels={
                        <>
                          <strong>{prerequisite.name}</strong>
                          <Badge>{prerequisite.coreOrPeripheral === 'core' ? 'cốt lõi' : 'phụ'}</Badge>
                          <Badge>{stateWord(prerequisite.review)}</Badge>
                        </>
                      }
                      quote={quotes(prerequisite.sourceSentenceKeys)}
                      source={source(prerequisite.sourceSentenceKeys)}
                      actions={
                        <ReviewActions
                          decided={prerequisite.review !== 'candidate'}
                          confirmLabel="Chấp nhận"
                          dismissLabel="Bác bỏ"
                          onConfirm={() => void review(target, 'accepted')}
                          onDismiss={() => void review(target, 'rejected')}
                          onUndo={() => void review(target, 'candidate')}
                        />
                      }
                    >
                      <p>{prerequisite.explanation || prerequisite.description}</p>
                      {(prerequisite.references.length > 0 || prerequisite.matches.length > 0) && (
                        <ul className={styles.refs}>
                          {prerequisite.references.map((reference, index) => (
                            <li key={index}>{referenceText(reference)}</li>
                          ))}
                          {prerequisite.matches.map((match) => (
                            <li key={match.contributionId}>
                              Khớp {match.matchType === 'strong' ? 'chặt' : 'lỏng'} với {match.contributionId}
                              {match.explanation && `: ${match.explanation}`}
                            </li>
                          ))}
                        </ul>
                      )}
                    </FindingCard>
                  );
                })}
              </div>
            )}
          </FindingCard>
        ))}
      </div>
    </section>
  );
}
