import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Search, X } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';
import { TextField } from '@/shared/ui/TextField';
import type { ModuleDefinition } from './moduleTypes';
import { modules } from './modules';
import styles from './shell.module.css';

const groupLabels: Record<ModuleDefinition['group'], string> = {
  home: 'Trang chủ',
  paper: 'Bài báo',
  analysis: 'Viết',
  data: 'Dữ liệu',
  labs: 'Khám phá',
  system: 'Hệ thống',
};

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
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const items = modules.filter(
    (item) =>
      !item.hiddenFromSearch &&
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
      <div className={styles.palette} role="dialog" aria-modal="true" aria-labelledby="palette-title">
        <header className={styles.paletteHeader}>
          <div>
            <h2 id="palette-title">Tìm chức năng</h2>
            <p>Đi nhanh đến trang hoặc công cụ bạn cần.</p>
          </div>
          <IconButton
            variant="ghost"
            size="sm"
            className={styles.paletteClose}
            label="Đóng"
            onClick={() => setOpen(false)}
          >
            <X size={17} aria-hidden="true" />
          </IconButton>
        </header>

        <div className={styles.paletteSearch}>
          <Search size={18} aria-hidden="true" />
          <TextField
            label="Tìm chức năng"
            ref={input}
            aria-label="Tìm chức năng"
            placeholder="Nhập tên trang hoặc chức năng…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                const first = items.find((item) => item.status !== 'soon');
                if (first) go(first.path);
              }
            }}
          />
        </div>

        <div className={styles.paletteResults}>
          <p className={styles.paletteSectionLabel}>Điều hướng</p>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                variant="ghost"
                className={styles.paletteItem}
                key={item.id}
                disabled={item.status === 'soon'}
                onClick={() => go(item.path)}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
                <small>{item.status === 'soon' ? 'Sắp có' : groupLabels[item.group]}</small>
                <ArrowRight size={15} aria-hidden="true" />
              </Button>
            );
          })}
          {items.length === 0 && (
            <p className={styles.paletteEmpty}>Không tìm thấy chức năng phù hợp.</p>
          )}
        </div>

        <footer className={styles.paletteFooter}>
          <span>Chọn một mục để mở</span>
          <span><kbd>Esc</kbd> Đóng</span>
        </footer>
      </div>
    </div>
  );
}
