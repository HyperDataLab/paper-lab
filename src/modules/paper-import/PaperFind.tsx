import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FindingLocation } from '@/core/paperFindings';
import type { Paper } from '@/core/schemas';
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
  return (
    <>
      <TextField
        label="Tìm trong bài"
        hideLabel
        placeholder="Tìm trong bài"
        size="sm"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') search();
        }}
      />
      {searched && (
        <span className={styles.count} role="status">
          {hits.length ? `${index + 1}/${hits.length}` : 'Không thấy'}
        </span>
      )}
      {hits.length > 1 && (
        <>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Kết quả trước"
            onClick={() => show((index - 1 + hits.length) % hits.length)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Kết quả sau"
            onClick={() => show((index + 1) % hits.length)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </>
      )}
      {sections.length > 1 && (
        <Select
          label="Mục"
          hideLabel
          size="sm"
          value=""
          onChange={(event) => {
            if (event.target.value) onSection(event.target.value);
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
    </>
  );
}
