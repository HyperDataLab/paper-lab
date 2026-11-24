import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Corpus } from '@/core/schemas/corpus';
import type { PassageSearchResponse, PassageStatus } from '@/core/schemas/passages';
import { useAuth } from '@/shared/auth/authContext';
import {
  getPassageStatus,
  passageLink,
  PassageError,
  reindexPassages,
  searchPassages,
} from '@/shared/passages/client';
import { isLabScope } from '@/shared/scope';
import { useHubProjectId } from '@/shared/storage/StorageProvider';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { TextField } from '@/shared/ui/TextField';
import { sectionRoleLabel } from './labels';
import styles from './passages.module.css';

const sourceLabels = { vector: 'Khớp ngữ nghĩa', keyword: 'Khớp từ khoá' } as const;

const asError = (cause: unknown, fallback: string) =>
  cause instanceof PassageError
    ? cause
    : new PassageError(fallback, cause instanceof Error ? cause.message : '');

/**
 * "Tìm đoạn văn": hybrid search over the full text of the corpus's papers (docs/plans/PASSAGE_INDEX.md). Each hit
 * opens its paragraph in the paper reader.
 */
export function CorpusPassages({ corpus }: { corpus: Corpus }) {
  const heading = useId();
  const { user, getIdToken } = useAuth();
  const projectId = useHubProjectId();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<PassageSearchResponse>();
  const [status, setStatus] = useState<PassageStatus>();
  const [error, setError] = useState<PassageError>();
  const [busy, setBusy] = useState<'search' | 'reindex'>();
  const [notice, setNotice] = useState('');
  const paperCount = useMemo(
    () => new Set(corpus.members.flatMap((member) => member.identifiers.paperIds)).size,
    [corpus.members],
  );
  const ready = !!user && !!projectId;

  useEffect(() => {
    if (!user || !projectId) return;
    const controller = new AbortController();
    void getIdToken()
      .then((token) => getPassageStatus(token, projectId, controller.signal))
      .then(setStatus)
      .catch(() => undefined);
    return () => controller.abort();
  }, [user, projectId, getIdToken]);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy('search');
    setError(undefined);
    try {
      setResult(
        await searchPassages({ query, corpusId: corpus.id, limit: 10 }, await getIdToken(), projectId),
      );
    } catch (cause) {
      setError(asError(cause, 'Không tìm được đoạn văn.'));
    } finally {
      setBusy(undefined);
    }
  }

  async function reindex() {
    setBusy('reindex');
    setError(undefined);
    setNotice('');
    try {
      const done = await reindexPassages({ corpusId: corpus.id }, await getIdToken(), projectId);
      setStatus(done.status);
      setNotice(
        `Đã xếp ${done.queued} bài vào hàng đợi lập chỉ mục, xong ngay ${done.processed}. Các bài còn lại xong trong vài phút.`,
      );
    } catch (cause) {
      setError(asError(cause, 'Không lập chỉ mục lại được.'));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Card>
      <section aria-labelledby={heading} className={styles.section}>
        <div className={styles.head}>
          <h2 id={heading}>Tìm đoạn văn</h2>
          <Button size="sm" disabled={!ready || !paperCount || !!busy} onClick={() => void reindex()}>
            {busy === 'reindex' ? 'Đang lập chỉ mục…' : 'Lập chỉ mục lại'}
          </Button>
        </div>
        <p className={styles.muted}>
          Tìm paragraph trong full text của {paperCount} bài có paper model; mỗi kết quả mở đúng paragraph
          trong bài.
          {status &&
            ` Chỉ mục ${isLabScope(projectId) ? 'của lab' : 'của project'}: ${status.passages} đoạn từ ${status.papers} bài${status.queue.pending ? `, còn ${status.queue.pending} bài đang chờ` : ''}.`}
        </p>
        {!user ? (
          <p className={styles.muted}>Cần đăng nhập bằng tài khoản lab để tìm đoạn văn.</p>
        ) : !projectId ? (
          <p className={styles.muted}>Mở PaperLab từ một project ResearchHub để tìm đoạn văn.</p>
        ) : null}
        <form className={styles.form} onSubmit={(event) => void search(event)} role="search">
          <div className={styles.query}>
            <TextField
              label="Câu hỏi hoặc từ khoá"
              type="search"
              value={query}
              placeholder="Ví dụ: bài nào đo staleness và đo thế nào"
              onChange={(event) => setQuery(event.target.value)}
              disabled={!ready || !paperCount}
            />
          </div>
          <Button type="submit" variant="primary" disabled={!ready || !paperCount || !query.trim() || !!busy}>
            {busy === 'search' ? 'Đang tìm…' : 'Tìm'}
          </Button>
        </form>
        {notice && (
          <p role="status" className={styles.muted}>
            {notice}
          </p>
        )}
        {error && (
          <div role="alert">
            {error.message}
            {error.detail && (
              <details>
                <summary>Chi tiết kỹ thuật</summary>
                {error.detail}
              </details>
            )}
          </div>
        )}
        {result &&
          (result.passages.length ? (
            <>
              <ol className={styles.results} aria-label="Đoạn văn tìm được">
                {result.passages.map((hit) => (
                  <li key={`${hit.paperId}/${hit.paragraphId}`} className={styles.hit}>
                    <div className={styles.place}>
                      <Link to={passageLink(hit.paperId, hit.paragraphId)}>
                        {hit.paperTitle || 'Bài chưa có title'}
                      </Link>
                      <Badge tone="accent">{sectionRoleLabel(hit.sectionRole)}</Badge>
                      <span className={styles.muted}>
                        {hit.sources.map((source) => sourceLabels[source]).join(' · ')}
                      </span>
                    </div>
                    <blockquote className={styles.quote}>{hit.text}</blockquote>
                  </li>
                ))}
              </ol>
              {result.truncated && (
                <p className={styles.muted}>Còn thêm đoạn khớp; hãy nêu câu hỏi cụ thể hơn để thu hẹp.</p>
              )}
            </>
          ) : (
            <p className={styles.muted}>
              Không tìm thấy đoạn văn phù hợp. Bài vừa thêm cần được lập chỉ mục trước; hãy bấm Lập chỉ mục
              lại rồi thử sau vài phút.
            </p>
          ))}
      </section>
    </Card>
  );
}
