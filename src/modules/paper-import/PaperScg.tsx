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
import { ActivityStatus } from '@/shared/ui/ActivityStatus';
import { ScgEvidence } from './ScgEvidence';
import { PublishScg } from './PublishScg';
import styles from './scg.module.css';

const STAGES: Record<ScgStage, string> = {
  contributions: 'Giai đoạn 1/3: trích contribution',
  prerequisites: 'Giai đoạn 2/3: tìm nền tảng (prerequisite)',
  alignment: 'Giai đoạn 3/3: nối với contribution của các bài khác',
  complete: 'Đã xong',
};
const stateWord = (review: ScgReview) =>
  review === 'accepted' ? 'Đã chấp nhận' : review === 'rejected' ? 'Đã bác bỏ' : 'Ứng viên';

function referenceText(reference: ScgReference) {
  if (reference.kind === 'contribution') return `Contribution ${reference.contributionId} của bài này`;
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
  const [selectedId, setSelectedId] = useState<string>();
  const [mobileDetail, setMobileDetail] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const model = useMemo(() => buildPaperModel({ paper, metadata: null, now: new Date() }), [paper]);
  const sentences = useMemo(() => new Map(model.sentences.map((s) => [s.key, s])), [model]);
  const sections = useMemo(
    () => new Map(paper.sections.map((section) => [section.id, section.heading])),
    [paper],
  );
  useEffect(() => {
    void repo.scg.get(paper.id).then(setRun);
    // Leaving the view stops the run; the checkpoint lets the next start resume it.
    return () => controller.current?.abort();
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
  const contributions = run?.contributions ?? [];
  const selected = contributions.find((contribution) => contribution.id === selectedId) ?? contributions[0];
  const droppedCount = run
    ? run.dropped.quotes +
      run.dropped.contributions +
      run.dropped.prerequisites +
      run.dropped.references +
      run.dropped.matches
    : 0;
  const unfinished = run && run.status !== 'complete';
  return (
    <section aria-label="Scientific Contribution Graph" className={styles.scg}>
      <h2>Scientific Contribution Graph</h2>
      <p className={styles.muted}>
        Mỗi contribution của bài, các nền tảng nó dựa vào, và chỗ nối với contribution của các bài khác trong
        thư viện. Kết quả là ứng viên cho tới khi bạn chấp nhận.
      </p>
      <div className={styles.toolbar}>
        <Button variant="primary" disabled={running || !model.sentences.length} onClick={() => void start()}>
          Trích contribution (SCG)
        </Button>
        {running && <Button onClick={() => controller.current?.abort()}>Dừng</Button>}
        {running && <ActivityStatus label="Đang trích contribution…" />}
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
      {run && <PublishScg paper={paper} run={run} busy={running} />}
      {run && droppedCount > 0 && (
        <details className={styles.dropped}>
          <summary>Thông tin mục bị bỏ qua ({droppedCount})</summary>
          <p className={styles.muted}>
            {run.dropped.quotes} trích dẫn, {run.dropped.contributions} contribution,{' '}
            {run.dropped.prerequisites} mục nền tảng, {run.dropped.references} tài liệu tham khảo và{' '}
            {run.dropped.matches} liên kết không được dùng.
          </p>
        </details>
      )}
      {run?.status === 'complete' && !run.contributions.length && <p>Không tìm thấy contribution nào.</p>}
      {contributions.length > 0 && (
        <div className={styles.workspace} data-mobile-detail={mobileDetail}>
          <aside className={styles.contributionList} aria-label="Danh sách contributions">
            <div className={styles.listHeading}>
              <h3>Contributions</h3>
              <span>{contributions.length}</span>
            </div>
            <ul>
              {contributions.map((contribution) => (
                <li key={contribution.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    className={styles.contributionOption}
                    aria-current={selected?.id === contribution.id ? 'true' : undefined}
                    onClick={() => {
                      setSelectedId(contribution.id);
                      setMobileDetail(true);
                    }}
                  >
                    <span className={styles.optionName}>{contribution.name}</span>
                    <span className={styles.optionMeta}>
                      <span>{contribution.types[0]?.type ?? 'Contribution'}</span>
                      <Badge tone={contribution.review === 'accepted' ? 'success' : undefined}>
                        {stateWord(contribution.review)}
                      </Badge>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </aside>
          {selected && (
            <article className={styles.detail} aria-label="Chi tiết contribution">
              <div className={styles.detailScroll}>
                <header className={styles.detailHeader}>
                  <Button
                    className={styles.mobileBack}
                    variant="ghost"
                    onClick={() => setMobileDetail(false)}
                  >
                    ← Quay lại danh sách
                  </Button>
                  <div className={styles.detailTitle}>
                    <div>
                      <h3>{selected.name}</h3>
                      <p className={styles.detailMeta}>
                        {selected.types.map((type) => (
                          <span key={type.type} title={type.explanation || SCG_CONTRIBUTION_TYPES[type.type]}>
                            <Badge tone="accent">{type.type}</Badge>
                          </span>
                        ))}
                        <Badge tone={selected.review === 'accepted' ? 'success' : undefined}>
                          {stateWord(selected.review)}
                        </Badge>
                      </p>
                    </div>
                    <span className={styles.detailId}>{selected.id}</span>
                  </div>
                </header>

                <section className={styles.detailSection} aria-labelledby="scg-summary-title">
                  <h4 id="scg-summary-title">Tóm tắt</h4>
                  <p>{selected.description}</p>
                </section>

                <section className={styles.detailSection} aria-labelledby="scg-source-title">
                  <h4 id="scg-source-title">Trích dẫn gốc</h4>
                  <ScgEvidence
                    keys={selected.sourceSentenceKeys}
                    sentences={sentences}
                    sections={sections}
                    onLocation={onLocation}
                    prefix={`contribution-${selected.id}`}
                  />
                  <p className={styles.muted}>
                    {selected.sections.length > 0
                      ? `Section: ${selected.sections.join(', ')}`
                      : 'Section chưa xác định'}
                  </p>
                </section>

                <section className={styles.detailSection} aria-labelledby="scg-prerequisites-title">
                  <div className={styles.sectionHeading}>
                    <h4 id="scg-prerequisites-title">Dựa trên</h4>
                    <span>{selected.prerequisites.length} mục</span>
                  </div>
                  {selected.prerequisites.length ? (
                    <div className={styles.prerequisiteList}>
                      {selected.prerequisites.map((prerequisite) => {
                        const target = { contributionId: selected.id, prerequisiteId: prerequisite.id };
                        return (
                          <details className={styles.prerequisite} key={prerequisite.id}>
                            <summary>
                              <span className={styles.prerequisiteName}>{prerequisite.name}</span>
                              <Badge>
                                {prerequisite.coreOrPeripheral === 'core' ? 'Cốt lõi' : 'Phụ trợ'}
                              </Badge>
                              <Badge tone={prerequisite.review === 'accepted' ? 'success' : undefined}>
                                {stateWord(prerequisite.review)}
                              </Badge>
                            </summary>
                            <div className={styles.prerequisiteBody}>
                              <p>{prerequisite.explanation || prerequisite.description}</p>
                              <ScgEvidence
                                keys={prerequisite.sourceSentenceKeys}
                                sentences={sentences}
                                sections={sections}
                                onLocation={onLocation}
                                prefix={`prerequisite-${prerequisite.id}`}
                              />
                              {(prerequisite.references.length > 0 || prerequisite.matches.length > 0) && (
                                <ul className={styles.refs}>
                                  {prerequisite.references.map((reference, index) => (
                                    <li key={index}>{referenceText(reference)}</li>
                                  ))}
                                  {prerequisite.matches.map((match) => (
                                    <li key={match.contributionId}>
                                      Khớp {match.matchType === 'strong' ? 'chặt' : 'lỏng'} với{' '}
                                      {match.contributionId}
                                      {match.explanation && `: ${match.explanation}`}
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {!running && (
                                <div
                                  role="group"
                                  className={styles.prerequisiteReview}
                                  aria-label={`Duyệt mục nền tảng: ${prerequisite.name}`}
                                >
                                  <span>Duyệt mục nền tảng</span>
                                  <ReviewButtons
                                    reviewValue={prerequisite.review}
                                    acceptText="Chấp nhận mục"
                                    rejectText="Loại mục"
                                    acceptedLabel={`Chấp nhận mục nền tảng: ${prerequisite.name}`}
                                    rejectedLabel={`Loại mục nền tảng: ${prerequisite.name}`}
                                    onAccept={() => void review(target, 'accepted')}
                                    onReject={() => void review(target, 'rejected')}
                                    onUndo={() => void review(target, 'candidate')}
                                  />
                                </div>
                              )}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  ) : (
                    <p className={styles.muted}>Chưa có mục nền tảng được xác minh.</p>
                  )}
                </section>
              </div>
              <footer className={styles.detailFooter} aria-label="Duyệt contribution">
                <div>
                  <strong>Duyệt contribution</strong>
                  <span>{stateWord(selected.review)}</span>
                </div>
                {!running && (
                  <ReviewButtons
                    reviewValue={selected.review}
                    acceptText="Chấp nhận"
                    rejectText="Loại"
                    acceptedLabel="Chấp nhận"
                    rejectedLabel="Loại contribution"
                    onAccept={() => void review({ contributionId: selected.id }, 'accepted')}
                    onReject={() => void review({ contributionId: selected.id }, 'rejected')}
                    onUndo={() => void review({ contributionId: selected.id }, 'candidate')}
                  />
                )}
              </footer>
            </article>
          )}
        </div>
      )}
    </section>
  );
}

function ReviewButtons({
  reviewValue,
  acceptText,
  rejectText,
  acceptedLabel,
  rejectedLabel,
  onAccept,
  onReject,
  onUndo,
}: {
  reviewValue: ScgReview;
  acceptText: string;
  rejectText: string;
  acceptedLabel: string;
  rejectedLabel: string;
  onAccept: () => void;
  onReject: () => void;
  onUndo: () => void;
}) {
  if (reviewValue !== 'candidate') {
    return (
      <div className={styles.reviewActions}>
        <Button onClick={onUndo}>Hoàn tác</Button>
      </div>
    );
  }
  return (
    <div className={styles.reviewActions}>
      <Button variant="danger" aria-label={rejectedLabel} onClick={onReject}>
        {rejectText}
      </Button>
      <Button variant="primary" aria-label={acceptedLabel} onClick={onAccept}>
        {acceptText}
      </Button>
    </div>
  );
}
