import { useRef } from 'react';
import { Search, X } from 'lucide-react';
import { IconButton } from '@/shared/ui/IconButton';
import { TextField } from '@/shared/ui/TextField';
import styles from '../sections/topicSection.module.css';

export function SearchQueryField({
  value,
  onChange,
  onCommit,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={styles.searchField}>
      <div className={styles.searchInput}>
        <TextField
          id="topic-search-query"
          label="Từ khoá tìm kiếm (tiếng Anh)"
          type="search"
          value={value}
          placeholder="Ví dụ: large language models title abstract screening systematic reviews"
          hint="Để trống để dùng phát biểu đề tài đã lưu."
          ref={inputRef}
          controlClassName={styles.searchControl}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => onCommit(value)}
        />
        <Search size={17} aria-hidden="true" className={styles.searchIcon} />
        {value && (
          <IconButton
            className={styles.clearSearch}
            label="Xoá từ khoá tìm kiếm"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange('');
              onCommit('');
              inputRef.current?.focus();
            }}
          >
            <X size={15} aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </div>
  );
}
