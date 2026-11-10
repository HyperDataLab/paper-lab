import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { ActionBar } from '@/shared/ui/ActionBar';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Dialog } from '@/shared/ui/Dialog';
import { Checkbox } from '@/shared/ui/Checkbox';
import { ReportMenu } from '@/shared/report/ReportMenu';
import { groupHistory } from './groupHistory';
import styles from './page.module.css';
import { Empty, Loading } from '@/shared/ui/StateNote';
type List = Awaited<ReturnType<ReturnType<typeof useRepositories>['analyses']['list']>>;
function relative(date: string) {
  const days = Math.round((Date.parse(date) - Date.now()) / 86400000);
  return new Intl.RelativeTimeFormat('vi', { numeric: 'auto' }).format(days, 'day');
}
export default function Page() {
  const repo = useRepositories();
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [paperTitles, setPaperTitles] = useState(new Map<string, string>());
  const [generations, setGenerations] = useState<Awaited<ReturnType<typeof repo.generations.list>>>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTrigger, setDeleteTrigger] = useState<HTMLElement | null>(null);
  const [revisions, setRevisions] = useState<
    Record<string, Awaited<ReturnType<typeof repo.revisions.listBySource>>>
  >({});
  const load = useCallback(() => {
    void repo.generations
      .list()
      .then(setGenerations)
      .catch((e: unknown) => setError(String(e)));
    void repo.papers
      .list()
      .then((papers) => setPaperTitles(new Map(papers.map((paper) => [paper.id, paper.title]))))
      .catch((e: unknown) => setError(String(e)));
    repo.analyses
      .list()
      .then(async (value) => {
        setList(value);
        const existing = new Set(value.items.map((item) => item.id));
        setSelected((current) => current.filter((id) => existing.has(id)));
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
  const groups = useMemo(() => groupHistory(list?.items ?? [], paperTitles), [list, paperTitles]);
  async function remove() {
    if (!deleting) return;
    try {
      await repo.analyses.delete(deleting);
      setSelected((current) => current.filter((id) => id !== deleting));
      setDeleting(null);
      load();
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className={styles.page}>
      <h1>Lịch sử</h1>
      <p className={styles.note}>
        Dữ liệu chỉ lưu trong trình duyệt này. <Link to="/transfer">Xuất JSON</Link> để sao lưu hoặc chuyển
        máy.
      </p>
      {selected.length > 0 && (
        <div className={styles.compareBar}>
          <ActionBar status={<span>Đã chọn {selected.length}/2 bản để so sánh</span>}>
            {selected.length === 2 && (
              <Link
                className={styles.compareLink}
                to={`/compare?${new URLSearchParams({ a: selected[0] ?? '', b: selected[1] ?? '' })}`}
              >
                So sánh hai bản phân tích
              </Link>
            )}
          </ActionBar>
        </div>
      )}
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
        <Loading label="Đang tải…" />
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
            <div className={styles.list}>
              {groups.map((group, position) => (
                <details key={group.key} className={styles.group} open={position === 0}>
                  <summary>
                    <span>{group.title}</span> <Badge>{group.count} đoạn</Badge>
                  </summary>
                  {group.sections.map((section) => (
                    <section key={section.heading ?? 'none'} className={styles.section}>
                      {section.heading && <h3>{section.heading}</h3>}
                      <ul className={styles.rows}>
                        {section.entries.map(({ item, label, fullLabel }) => (
                          <li key={item.id} className={styles.row}>
                            <Checkbox
                              checked={selected.includes(item.id)}
                              disabled={selected.length === 2 && !selected.includes(item.id)}
                              onChange={(event) =>
                                setSelected(
                                  event.target.checked
                                    ? [...selected, item.id]
                                    : selected.filter((id) => id !== item.id),
                                )
                              }
                            >
                              <span className={styles.srOnly}>Chọn để so sánh: {fullLabel}</span>
                            </Checkbox>
                            <div className={styles.rowMain}>
                              <Link to={`/evaluate?id=${item.id}`}>{label}</Link>
                              <p>
                                {relative(item.updatedAt)} · {item.sentenceCount} câu · {item.issueCount} gợi
                                ý
                              </p>
                              {(revisions[item.id]?.length ?? 0) > 0 && (
                                <ul className={styles.revisions}>
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
                            <ReportMenu id={item.id} />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                setDeleteTrigger(event.currentTarget);
                                setDeleting(item.id);
                              }}
                            >
                              Xoá
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </details>
              ))}
            </div>
          )}
        </>
      )}
      <Card>
        <h2>Đoạn đã soạn</h2>
        {generations.length ? (
          <ul className={styles.rows}>
            {generations.map((item) => (
              <li key={item.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <Link to={`/generate?id=${item.id}`}>{item.input.mainClaim}</Link>
                  <p>{new Date(item.createdAt).toLocaleString('vi')}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="Chưa có đoạn đã soạn." />
        )}
      </Card>
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
            <Button variant="danger" onClick={() => void remove()}>
              Xoá bản phân tích
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
