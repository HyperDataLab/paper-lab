import { useEffect, useMemo, useRef, useState } from 'react';
import { finishLabelQueue, resumableLabelQueue, startLabelQueue } from '@/core/corpus/labelQueue';
import type { Corpus } from '@/core/schemas/corpus';
import { useLlm } from '@/shared/llm/LlmProvider';
import { describeLlmError } from '@/shared/llm/describeError';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Checkbox } from '@/shared/ui/Checkbox';
import {
  LABEL_VERSIONS,
  corpusLabelEstimate,
  labelCovered,
  type LabelPaper,
  type LabelScheme,
} from './labelPlan';
import { labelMember, labelMembers, runLabelQueue, type LabelRunners } from './labelRun';
import { schemeNames } from './labels';
import styles from './corpus.module.css';

const SCHEMES: LabelScheme[] = ['rhetoric', 'stance', 'arguments'];

export function CorpusLabelling({
  corpus,
  items,
  save,
  runners,
}: {
  corpus: Corpus;
  items: LabelPaper[] | undefined;
  save: (value: Corpus) => Promise<void>;
  /** Test seam: replaces the per-paper runners. */
  runners?: LabelRunners;
}) {
  const repo = useRepositories();
  const llm = useLlm();
  const [schemes, setSchemes] = useState<LabelScheme[]>(['rhetoric', 'stance']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const control = useRef<'run' | 'pause' | 'cancel'>('run');
  const abort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      control.current = 'pause';
      abort.current?.abort();
    },
    [],
  );
  const queue = corpus.labelQueue;
  async function run(resume: boolean) {
    setError('');
    // Asked once for the whole run; the runners check the stored consent again before every call.
    if (!(await llm.ensureConsent('paper'))) return;
    setBusy(true);
    control.current = 'run';
    const controller = new AbortController();
    abort.current = controller;
    try {
      const stored = (await repo.corpora.get(corpus.id)) ?? corpus;
      const now = new Date().toISOString();
      // A new run over an unfinished one records the old one as cancelled, so its counts are not lost.
      const latest =
        !resume && resumableLabelQueue(stored.labelQueue)
          ? finishLabelQueue(stored, 'cancelled', now)
          : stored;
      const started =
        resume && latest.labelQueue
          ? { ...latest, labelQueue: { ...latest.labelQueue, status: 'running' as const } }
          : startLabelQueue(latest, {
              schemes,
              memberIds: labelMembers(latest).map((m) => m.memberId),
              model: llm.config.model,
              promptVersions: Object.fromEntries(schemes.map((s) => [s, LABEL_VERSIONS[s]])),
              now,
            });
      await save({ ...started, updatedAt: now });
      await runLabelQueue({
        load: () => repo.corpora.get(corpus.id),
        save,
        control: () => control.current,
        label: (member, list) =>
          labelMember(member, list, {
            repo,
            client: llm.client,
            config: llm.config,
            signal: controller.signal,
            runners,
          }),
      });
    } catch (cause) {
      setError(describeLlmError(cause) ?? String(cause));
    } finally {
      abort.current = null;
      setBusy(false);
    }
  }
  async function cancelPaused() {
    const latest = (await repo.corpora.get(corpus.id)) ?? corpus;
    const at = new Date().toISOString();
    await save({ ...finishLabelQueue(latest, 'cancelled', at), updatedAt: at });
  }
  const { estimate, toRun } = useMemo(
    () => ({
      estimate: items ? corpusLabelEstimate(items, schemes) : null,
      toRun: items?.filter((item) => schemes.some((s) => !labelCovered(item, s))).length ?? 0,
    }),
    [items, schemes],
  );
  // One prompt version and model per run (CORPUS_PLAN section 2): a queue started under others is not resumed.
  const sameVersions = Boolean(
    queue &&
    queue.model === llm.config.model &&
    queue.schemes.every((s) => queue.promptVersions[s] === LABEL_VERSIONS[s]),
  );
  const resumable = resumableLabelQueue(queue);
  const stop = (value: 'pause' | 'cancel') => {
    control.current = value;
    abort.current?.abort();
  };
  return (
    <Card className={styles.labelingCard}>
      <section aria-labelledby="corpus-labelling" className={`${styles.members} ${styles.labeling}`}>
        <div className={styles.cardHead}>
          <h2 id="corpus-labelling">Gắn nhãn cho corpus</h2>
        </div>
        <p className={styles.muted}>
          Chạy từng bài đã dựng paper model, bằng đúng các phân tích của trang bài báo. Bài đã có nhãn của
          prompt hiện tại được bỏ qua; nhãn của prompt khác được chạy lại. Cần giữ tab mở trong khi chạy.
        </p>
        <div className={styles.labelSchemes} role="group" aria-label="Loại nhãn">
          {SCHEMES.map((scheme) => (
            <div
              key={scheme}
              className={`${styles.labelScheme} ${schemes.includes(scheme) ? styles.labelSchemeSelected : ''}`}
            >
              <Checkbox
                checked={schemes.includes(scheme)}
                disabled={busy}
                onChange={(e) =>
                  setSchemes((list) =>
                    e.target.checked
                      ? SCHEMES.filter((s) => s === scheme || list.includes(s))
                      : list.filter((s) => s !== scheme),
                  )
                }
              >
                {schemeNames[scheme]}
              </Checkbox>
              <span>{schemes.includes(scheme) ? 'Đang chọn' : 'Tuỳ chọn'}</span>
            </div>
          ))}
        </div>
        <div className={styles.labelRunBar}>
          <div className={styles.labelEstimate} role="status" aria-live="polite">
            <strong>{estimate ?? '—'}</strong>
            <span>
              <b>lượt gọi AI ước tính</b>
              <small>
                {estimate === null
                  ? 'Đang tính khối lượng xử lý…'
                  : `${toRun}/${items?.length ?? 0} bài đã dựng model cần gắn nhãn`}
              </small>
            </span>
          </div>
          <div className={styles.labelActions}>
            <Button
              variant="primary"
              disabled={busy || !schemes.length || !items?.length}
              onClick={() => void run(false)}
            >
              Bắt đầu gắn nhãn
            </Button>
            {!busy && resumable && (
              <>
                {sameVersions && <Button onClick={() => void run(true)}>Tiếp tục</Button>}
                <Button variant="ghost" onClick={() => void cancelPaused()}>
                  Hủy lượt chạy
                </Button>
              </>
            )}
            {busy && (
              <>
                <Button onClick={() => stop('pause')}>Tạm dừng</Button>
                <Button variant="ghost" onClick={() => stop('cancel')}>
                  Hủy
                </Button>
              </>
            )}
          </div>
        </div>
        {!items?.length && estimate !== null && (
          <p className={styles.labelEmptyHint}>Dựng paper model cho bài trong corpus để bắt đầu gắn nhãn.</p>
        )}
        {!busy && resumable && !sameVersions && (
          <p className={styles.muted}>
            Lượt chạy dở dùng prompt hoặc model khác với hiện tại; hãy bắt đầu lượt mới.
          </p>
        )}
        {queue && (
          <p className={styles.labelQueueStatus}>
            {queue.schemes
              .map((s) => {
                const c = queue.counts[s];
                return `${schemeNames[s]}: xong ${c?.done ?? 0}, lỗi ${c?.failed ?? 0}, bỏ qua ${c?.skipped ?? 0}`;
              })
              .join(' · ')}{' '}
            · Còn lại: {queue.pending.length}
          </p>
        )}
        {queue?.failed.slice(-5).map((f) => (
          <p key={`${f.memberId}-${f.scheme}`} className={styles.labelFailure}>
            {corpus.members.find((m) => m.memberId === f.memberId)?.title ?? f.memberId} (
            {schemeNames[f.scheme]}
            ): {f.reason}
          </p>
        ))}
        {corpus.runs.length > 0 && (
          <ol className={styles.releases} aria-label="Các lượt gắn nhãn">
            {[...corpus.runs].reverse().map((r, index) => (
              <li key={`${r.createdAt}-${r.scheme}-${index}`}>
                <code>{r.promptVersion || '—'}</code>
                <span>
                  {schemeNames[r.scheme as LabelScheme] ?? r.scheme}, {r.model}: xong {r.done}, lỗi {r.failed}
                  , bỏ qua {r.skipped} · {new Date(r.createdAt).toLocaleString('vi-VN')}
                </span>
              </li>
            ))}
          </ol>
        )}
        {error && (
          <p className={styles.labelFailure} role="alert">
            {error}
          </p>
        )}
      </section>
    </Card>
  );
}
