import { Upload } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import styles from './ui.module.css';

/**
 * A file target in the shape people know from Drive and Dropbox: the whole area opens the file picker,
 * a dragged file lights it up, and what is happening shows inside it. The input stays focusable
 * (visually hidden), so the area works from the keyboard.
 */
export function Dropzone({
  inputLabel,
  title,
  hint,
  accept,
  busy = false,
  status,
  onFile,
}: {
  inputLabel: string;
  title: string;
  hint: ReactNode;
  accept: string;
  busy?: boolean;
  status?: ReactNode;
  onFile: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <label
      className={styles.dropzone}
      data-dragging={dragging}
      data-busy={busy}
      onDragOver={(event) => {
        event.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file && !busy) onFile(file);
      }}
    >
      <input
        className={styles.srOnly}
        type="file"
        accept={accept}
        aria-label={inputLabel}
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />
      <span className={styles.dropIcon} aria-hidden="true">
        {busy ? <span className={styles.spinner} /> : <Upload size={20} />}
      </span>
      <span className={styles.dropTitle}>{busy ? (status ?? 'Đang xử lý tệp…') : title}</span>
      {!busy && <span className={styles.dropHint}>{hint}</span>}
      {busy && (
        <span role="status" className={styles.srOnly}>
          {status ?? 'Đang xử lý tệp…'}
        </span>
      )}
    </label>
  );
}
