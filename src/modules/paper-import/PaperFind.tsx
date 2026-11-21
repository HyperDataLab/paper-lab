import { ListTree, Search, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FindingLocation } from '@/core/paperFindings';
import type { Paper } from '@/core/schemas';
import { IconButton } from '@/shared/ui/IconButton';
import { Button } from '@/shared/ui/Button';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { findInPaper } from './findInPaper';
import styles from './pdf.module.css';

/**
 * Finding one's way in a long paper: a phrase search over its text, and a jump to a section. Both open the
 * place in the PDF the same way a finding does.
 */
export function PaperFind({
  paper,
  onGo,
  onSection,
}: {
  paper: Paper;
  onGo: (location: FindingLocation) => void;
  onSection: (sectionId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [index, setIndex] = useState(0);
  const [openTool, setOpenTool] = useState<'search' | 'outline' | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => findInPaper(paper, searched), [paper, searched]);
  const show = (next: number) => {
    const hit = hits[next];
    if (!hit) return;
    setIndex(next);
    onGo(hit);
  };
  const search = () => {
    if (query === searched) return show(hits.length ? (index + 1) % hits.length : 0);
    setSearched(query);
    const found = findInPaper(paper, query);
    setIndex(0);
    if (found[0]) onGo(found[0]);
  };
  const sections = paper.sections.filter((section) =>
    paper.paragraphs.some((paragraph) => paragraph.sectionId === section.id && paragraph.kind === 'body'),
  );
  useEffect(() => {
    if (!openTool) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpenTool(null);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenTool(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [openTool]);
  return (
    <div ref={root} className={styles.readerTools}>
      <IconButton
        label="Tìm trong bài"
        aria-expanded={openTool === 'search'}
        onClick={() => setOpenTool(openTool === 'search' ? null : 'search')}
      >
        <Search size={16} aria-hidden="true" />
      </IconButton>
      {sections.length > 1 && (
        <IconButton
          label="Mục lục bài báo"
          aria-expanded={openTool === 'outline'}
          onClick={() => setOpenTool(openTool === 'outline' ? null : 'outline')}
        >
          <ListTree size={16} aria-hidden="true" />
        </IconButton>
      )}
      {searched && openTool !== 'search' && (
        <span className={styles.count} role="status">
          {hits.length ? `${index + 1}/${hits.length}` : 'Không thấy'}
        </span>
      )}
      {openTool && (
        <div
          className={styles.findPopover}
          role="dialog"
          aria-label={openTool === 'search' ? 'Tìm trong bài' : 'Mục lục bài báo'}
        >
          <IconButton label="Đóng" className={styles.findClose} onClick={() => setOpenTool(null)}>
            <X size={16} aria-hidden="true" />
          </IconButton>
          {openTool === 'search' ? (
            <form
              className={styles.findForm}
              onSubmit={(event) => {
                event.preventDefault();
                search();
              }}
            >
              <TextField
                label="Tìm trong bài"
                placeholder="Tìm trong bài"
                size="sm"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button type="submit" size="sm" variant="primary">
                Tìm
              </Button>
              {searched && (
                <span className={styles.count} role="status">
                  {hits.length ? `${index + 1}/${hits.length}` : 'Không thấy'}
                </span>
              )}
              {hits.length > 1 && (
                <div className={styles.hitControls}>
                  <IconButton
                    label="Kết quả trước"
                    size="sm"
                    onClick={() => show((index - 1 + hits.length) % hits.length)}
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                  </IconButton>
                  <IconButton label="Kết quả sau" size="sm" onClick={() => show((index + 1) % hits.length)}>
                    <ChevronRight size={16} aria-hidden="true" />
                  </IconButton>
                </div>
              )}
            </form>
          ) : (
            <Select
              label="Chọn mục"
              size="sm"
              value=""
              onChange={(event) => {
                if (event.target.value) {
                  onSection(event.target.value);
                  setOpenTool(null);
                }
              }}
            >
              <option value="">Chọn mục…</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.heading}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}
    </div>
  );
}
