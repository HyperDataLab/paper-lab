import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Dialog } from '@/shared/ui/Dialog';
import styles from './page.module.css';
type List = Awaited<ReturnType<ReturnType<typeof useRepositories>['analyses']['list']>>;
function relative(date: string) {
  const days = Math.round((Date.parse(date) - Date.now()) / 86400000);
  return new Intl.RelativeTimeFormat('vi', { numeric: 'auto' }).format(days, 'day');
}
export default function Page() {
  const repo = useRepositories();
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTrigger, setDeleteTrigger] = useState<HTMLElement | null>(null);
  const [revisions, setRevisions] = useState<
    Record<string, Awaited<ReturnType<typeof repo.revisions.listBySource>>>
  >({});
  const load = useCallback(() => {
    repo.analyses
      .list()
      .then(async (value) => {
        setList(value);
        const entries = await Promise.all(
          value.items.map(async (item) => [item.id, await repo.revisions.listBySource(item.id)] as const),
        );
        setRevisions(Object.fromEntries(entries));
      })
      .catch((e: unknown) => setError(String(e)));
  }, [repo]);
  useEffect(() => {
    load();
  }, [load]);
  async function remove() {
    if (!deleting) return;
    try {
      await repo.analyses.delete(deleting);
      setDeleting(null);
      load();
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className={styles.page}>
      <h1>Lịch sử</h1>
      <Card>
        <p>Dữ liệu chỉ lưu trong trình duyệt này. Hãy xuất JSON để sao lưu hoặc chuyển máy.</p>
        <Link to="/transfer">Xuất JSON</Link>
      </Card>
      {error && (
        <div role="alert">
          Không thể tải lịch sử. <Button onClick={load}>Thử lại</Button>
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            {error}
          </details>
        </div>
      )}
      {!list ? (
        <p>Đang tải…</p>
      ) : (
        <>
          {list.corrupt > 0 && <p role="alert">Bản ghi bị lỗi: {list.corrupt}</p>}
          {list.items.length === 0 ? (
            <>
              <EmptyState
                title="Chưa có bản phân tích"
                description="Dữ liệu được lưu trong trình duyệt này."
                detail="Hãy xuất JSON để sao lưu."
              />
              <Link to="/evaluate">Phân tích đoạn văn</Link>
            </>
          ) : (
            <ul className={styles.list}>
              {list.items.map((item) => (
                <li key={item.id}>
                  <Card>
                    <div className={styles.row}>
                      <div>
                        <Link to={`/evaluate?id=${item.id}`}>{item.title || item.preview}</Link>
                        <p>
                          {relative(item.updatedAt)} · {item.sentenceCount} câu ·{' '}
                          {item.sourceHash.slice(7, 15)}
                        </p>
                        {(revisions[item.id]?.length ?? 0) > 0 && (
                          <ul>
                            {revisions[item.id]?.map((revision) => (
                              <li key={revision.id}>
                                <Link
                                  to={`/revise?${new URLSearchParams({ analysis: item.id, revision: revision.id })}`}
                                >
                                  Bản sửa · {new Date(revision.createdAt).toLocaleString('vi')}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <Button
                        onClick={(event) => {
                          setDeleteTrigger(event.currentTarget);
                          setDeleting(item.id);
                        }}
                      >
                        Xoá
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {deleting && (
        <Dialog
          title="Xoá bản phân tích này?"
          description="Nhật ký kiểm tra vẫn được giữ lại."
          returnFocus={deleteTrigger}
          onClose={() => setDeleting(null)}
        >
          <div className={styles.actions}>
            <Button data-dialog-initial-focus onClick={() => setDeleting(null)}>
              Huỷ
            </Button>
            <Button onClick={() => void remove()}>Xoá bản phân tích</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
