import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/TextField';
import { modules } from './modules';
import styles from './shell.module.css';
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const items = modules.filter((item) =>
    item.label.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')),
  );
  function go(path: string) {
    navigate(path);
    setOpen(false);
    setQuery('');
  }
  if (!open) return null;
  return (
    <div
      className={styles.paletteOverlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className={styles.palette} role="dialog" aria-modal="true" aria-label="Tìm chức năng">
        <TextField
          label="Tìm chức năng"
          ref={input}
          aria-label="Tìm chức năng"
          placeholder="Tìm chức năng…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const first = items.find((item) => item.status !== 'soon');
              if (first) go(first.path);
            }
          }}
        />
        <div>
          {items.map((item) => (
            <Button
              variant="ghost"
              key={item.id}
              disabled={item.status === 'soon'}
              onClick={() => go(item.path)}
            >
              {item.label}
              {item.status === 'soon' && ' · Sắp có'}
            </Button>
          ))}
          {items.length === 0 && <p>Không tìm thấy chức năng.</p>}
        </div>
      </div>
    </div>
  );
}
