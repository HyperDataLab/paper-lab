import { useMemo, useState } from 'react';
import type { KgNode } from '@/core/openkg';
import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/TextField';
import { NODE_LABELS } from '@/shared/ui/openkg/labels';
import styles from '@/shared/ui/openkg/openkg.module.css';
import corpusStyles from './corpus-openkg.module.css';

const PAGE_SIZE = 40;

export function OpenKgNodeList({
  nodes,
  selected,
  onSelect,
}: {
  nodes: KgNode[];
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const matching = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('vi');
    return nodes
      .filter(({ label }) => label.toLocaleLowerCase('vi').includes(needle))
      .sort((a, b) => a.label.localeCompare(b.label, 'vi') || a.id.localeCompare(b.id));
  }, [nodes, query]);
  const pages = Math.ceil(matching.length / PAGE_SIZE);
  const current = Math.min(page, Math.max(0, pages - 1));
  const shown = matching.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  return (
    <details className={styles.textList}>
      <summary>Danh sách nút ({nodes.length})</summary>
      <TextField
        label="Tìm nút theo tên"
        size="sm"
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(0);
        }}
      />
      {shown.length ? (
        <ul className={corpusStyles.nodeList}>
          {shown.map(({ id, label, type }) => (
            <li key={id}>
              <Button variant="ghost" size="sm" aria-pressed={id === selected} onClick={() => onSelect(id)}>
                {label} · {NODE_LABELS[type]}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>Không tìm thấy nút.</p>
      )}
      {pages > 1 && (
        <div className={corpusStyles.pagination}>
          <Button size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Trang trước
          </Button>
          <span aria-live="polite">
            Trang {current + 1}/{pages}
          </span>
          <Button size="sm" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>
            Trang sau
          </Button>
        </div>
      )}
    </details>
  );
}
