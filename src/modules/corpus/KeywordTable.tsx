import { useState } from 'react';
import type { CorpusKeyword } from '@/core/schemas/corpusKeywords';
import { Button } from '@/shared/ui/Button';
import { DataTable } from '@/shared/ui/DataTable';

type Key = 'name' | 'paperCount' | 'share' | 'meanScore';
const columns: [Key, string][] = [
  ['name', 'Keyword'],
  ['paperCount', 'Số bài'],
  ['share', 'Tỉ lệ'],
  ['meanScore', 'Điểm TB'],
];
const ROWS = 100;

export function KeywordTable({
  keywords,
  selected,
  onSelect,
}: {
  keywords: CorpusKeyword[];
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  const [sort, setSort] = useState<{ key: Key; descending: boolean }>({
    key: 'paperCount',
    descending: true,
  });
  const [all, setAll] = useState(false);
  const sorted = [...keywords].sort((a, b) => {
    const order =
      sort.key === 'name'
        ? a.name.localeCompare(b.name)
        : a[sort.key] - b[sort.key] || a.name.localeCompare(b.name);
    return sort.descending ? -order : order;
  });
  const shown = all ? sorted : sorted.slice(0, ROWS);
  return (
    <>
      <DataTable aria-label="Keyword của corpus">
        <thead>
          <tr>
            {columns.map(([key, label]) => (
              <th
                key={key}
                aria-sort={sort.key === key ? (sort.descending ? 'descending' : 'ascending') : undefined}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSort((old) => ({
                      key,
                      descending: old.key === key ? !old.descending : key !== 'name',
                    }))
                  }
                >
                  {label}
                  {sort.key === key ? (sort.descending ? ' ↓' : ' ↑') : ''}
                </Button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((keyword) => (
            <tr key={keyword.id}>
              <th scope="row">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={selected === keyword.id}
                  onClick={() => onSelect(keyword.id)}
                >
                  {keyword.name}
                </Button>
              </th>
              <td>{keyword.paperCount}</td>
              <td>{`${(keyword.share * 100).toFixed(1)}%`}</td>
              <td>{keyword.meanScore.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      {sorted.length > ROWS && (
        <Button variant="ghost" size="sm" onClick={() => setAll((old) => !old)}>
          {all ? `Chỉ hiện ${ROWS} dòng đầu` : `Hiện cả ${sorted.length} keyword`}
        </Button>
      )}
    </>
  );
}
