import { useRef } from 'react';
import type { BankJournal } from '@/core/schemas/bankCatalog';
import { JOURNAL_SEARCH_LIMIT } from '@/shared/bank/journals';
import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/TextField';
import styles from './corpus.module.css';

const kindLabels = { journal: 'Tạp chí', conference: 'Hội nghị' };

export function JournalPicker({
  query,
  matches,
  onQuery,
  onChoose,
}: {
  query: string;
  matches?: BankJournal[];
  onQuery: (query: string) => void;
  onChoose: (journal: BankJournal) => void;
}) {
  const search = useRef<HTMLInputElement>(null);
  return (
    <div className={styles.journalPicker}>
      <TextField
        ref={search}
        type="search"
        label="Chọn tạp chí từ Writing Bank"
        placeholder="Tên tạp chí, ISSN hoặc OpenAlex source id"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
      />
      {query.trim().length >= 2 && !matches?.length && (
        <p className={styles.muted} role="status">
          {matches ? 'Không tìm thấy tạp chí hoặc hội nghị.' : 'Đang tìm…'}
        </p>
      )}
      {matches && matches.length > 0 && (
        <ul className={styles.journalResults} aria-label="Kết quả tìm tạp chí">
          {matches.slice(0, JOURNAL_SEARCH_LIMIT).map((journal) => (
            <li key={journal.id}>
              <Button
                variant="ghost"
                onClick={() => {
                  onChoose(journal);
                  search.current?.focus();
                }}
              >
                {[journal.name, journal.issns.join(', '), kindLabels[journal.kind]]
                  .filter(Boolean)
                  .join(' · ')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
