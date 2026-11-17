import { useCallback, useEffect, useRef, useState } from 'react';
import type { Paper } from '@/core/schemas';
import { useAuth } from '@/shared/auth/authContext';
import {
  FACT_REQUEST_STATES,
  FactRequestError,
  listFactRequests,
  type FactRequest,
  type FactRequestState,
} from '@/shared/pdfStore/factRequests';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Chip } from '@/shared/ui/Chip';
import { PageHeader } from '@/shared/ui/PageHeader';
import { Empty, Loading } from '@/shared/ui/StateNote';
import { papersByPublishedId } from './localPapers';
import { RequestCard } from './RequestCard';
import { STATE_LABELS } from './stateLabels';
import styles from './admin.module.css';

const LEAD =
  'Hệ thống khác xin dữ kiện thí nghiệm của bài đã công bố. Duyệt hoặc từ chối; sau khi duyệt, chạy Đo lường và công bố. Không có gì tự chạy.';

type Listing =
  | { status: 'loading' }
  | { status: 'error'; message: string; detail: string }
  | { status: 'ready'; items: FactRequest[]; nextCursor: string | null };

const failure = (error: unknown): Listing => ({
  status: 'error',
  message: error instanceof FactRequestError ? error.message : 'Không tải được danh sách yêu cầu.',
  detail: error instanceof Error ? error.message : String(error),
});

/** The requests in one state, each with the paper in this browser it matches, if any. */
export function RequestList() {
  const { getIdToken } = useAuth();
  const repo = useRepositories();
  const [filter, setFilter] = useState<FactRequestState>('requested');
  const filterRef = useRef(filter);
  const [listing, setListing] = useState<Listing>({ status: 'loading' });
  const [moreLoading, setMoreLoading] = useState(false);
  const [local, setLocal] = useState<Map<string, Paper>>(() => new Map());
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void repo.papers.list().then((papers) => setLocal(papersByPublishedId(papers)));
  }, [repo]);

  const fetchPage = useCallback(
    async (state: FactRequestState, cursor?: string) => {
      const token = await getIdToken();
      if (!token) throw new FactRequestError(401);
      return listFactRequests(token, state, cursor);
    },
    [getIdToken],
  );

  useEffect(() => {
    let live = true;
    fetchPage(filter).then(
      (page) => live && setListing({ status: 'ready', ...page }),
      (error: unknown) => live && setListing(failure(error)),
    );
    return () => {
      live = false;
    };
  }, [fetchPage, filter, reload]);

  function choose(state: FactRequestState) {
    filterRef.current = state;
    setFilter(state);
    setNotice('');
    setListing({ status: 'loading' });
  }
  function retry() {
    setListing({ status: 'loading' });
    setReload((value) => value + 1);
  }
  function conflict() {
    setNotice('Một yêu cầu đã được xử lý ở nơi khác, nên danh sách đã được tải lại.');
    setReload((value) => value + 1);
  }
  async function loadMore() {
    if (listing.status !== 'ready' || !listing.nextCursor) return;
    setMoreLoading(true);
    const asked = filter;
    try {
      const page = await fetchPage(asked, listing.nextCursor);
      // Decisions made while the page loaded are kept; a page for a filter left meanwhile is dropped.
      setListing((old) =>
        old.status === 'ready' && filterRef.current === asked
          ? { status: 'ready', items: [...old.items, ...page.items], nextCursor: page.nextCursor }
          : old,
      );
    } catch (error) {
      if (filterRef.current === asked) setListing(failure(error));
    } finally {
      setMoreLoading(false);
    }
  }
  function replace(updated: FactRequest) {
    // The decided request stays where it was, so the admin sees its next step; the next load files it by state.
    // The decision answer is the bare request, so the paper's title and DOI from the list are kept.
    setListing((old) =>
      old.status === 'ready'
        ? {
            ...old,
            items: old.items.map((item) =>
              item.paperId === updated.paperId
                ? { ...updated, title: updated.title ?? item.title, doi: updated.doi ?? item.doi }
                : item,
            ),
          }
        : old,
    );
  }

  return (
    <>
      <PageHeader title="Duyệt yêu cầu" lead={LEAD} />
      <div className={styles.filters} role="group" aria-label="Lọc theo trạng thái">
        {FACT_REQUEST_STATES.map((state) => (
          <Chip key={state} aria-pressed={filter === state} onClick={() => choose(state)}>
            {STATE_LABELS[state]}
          </Chip>
        ))}
      </div>
      {notice && <p role="status">{notice}</p>}
      {listing.status === 'loading' && <Loading label="Đang tải yêu cầu…" />}
      {listing.status === 'error' && (
        <div role="alert">
          <p>{listing.message}</p>
          <Button onClick={retry}>Thử lại</Button>
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            <p>{listing.detail}</p>
          </details>
        </div>
      )}
      {listing.status === 'ready' &&
        (listing.items.length === 0 ? (
          <Empty
            title={`Không có yêu cầu nào ở trạng thái “${STATE_LABELS[filter]}”`}
            hint="Yêu cầu mới xuất hiện ở Đang chờ khi một hệ thống khác xin dữ kiện thí nghiệm."
          />
        ) : (
          <>
            <div className={styles.list}>
              {listing.items.map((request) => (
                <RequestCard
                  key={request.paperId}
                  request={request}
                  localPaper={local.get(request.paperId)}
                  onDecided={replace}
                  onConflict={conflict}
                />
              ))}
            </div>
            {listing.nextCursor && (
              <div className={styles.more}>
                <Button disabled={moreLoading} onClick={() => void loadMore()}>
                  {moreLoading ? 'Đang tải…' : 'Tải thêm'}
                </Button>
              </div>
            )}
          </>
        ))}
    </>
  );
}
