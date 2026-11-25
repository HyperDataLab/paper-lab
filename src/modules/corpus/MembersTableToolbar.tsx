import { ArrowUpDown, Check, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/shared/ui/Button';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import styles from './corpus.module.css';

type Panel = 'filters' | 'sort' | null;
type Position = { top: number; left: number; width: number };

const RETRIEVAL_LABELS: Record<string, string> = {
  retrieved: 'Đã lấy',
  sought: 'Đang tìm',
  not_retrieved: 'Không lấy được',
};
const READ_LABELS: Record<string, string> = {
  FULL_TEXT: 'Toàn văn',
  ABSTRACT_ONLY: 'Abstract',
  METADATA_ONLY: 'Siêu dữ liệu',
};
const SORT_OPTIONS = [
  { value: 'default', label: 'Thứ tự ban đầu' },
  { value: 'retrieved_first', label: 'Đã lấy trước' },
  { value: 'title_asc', label: 'Tiêu đề A–Z' },
  { value: 'title_desc', label: 'Tiêu đề Z–A' },
  { value: 'year_desc', label: 'Năm mới nhất' },
  { value: 'year_asc', label: 'Năm cũ nhất' },
] as const;

function panelPosition(
  trigger: HTMLButtonElement,
  width: number,
  height: number,
  alignEnd = false,
): Position {
  const rect = trigger.getBoundingClientRect();
  const safeWidth = Math.min(width, window.innerWidth - 24);
  const desiredLeft = alignEnd ? rect.right - safeWidth : rect.left;
  const left = Math.max(12, Math.min(desiredLeft, window.innerWidth - safeWidth - 12));
  const below = rect.bottom + 8;
  const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - height - 8);
  return { top, left, width: safeWidth };
}

export function MembersTableToolbar({
  query,
  onQueryChange,
  retrievalFilter,
  onRetrievalFilterChange,
  readFilter,
  onReadFilterChange,
  sort,
  onSortChange,
  visibleCount,
  totalCount,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  retrievalFilter: string;
  onRetrievalFilterChange: (value: string) => void;
  readFilter: string;
  onReadFilterChange: (value: string) => void;
  sort: string;
  onSortChange: (value: string) => void;
  visibleCount: number;
  totalCount: number;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [position, setPosition] = useState<Position>();
  const panelId = useId();
  const filterTrigger = useRef<HTMLSpanElement>(null);
  const sortTrigger = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeFilterCount = Number(retrievalFilter !== 'all') + Number(readFilter !== 'all');
  const filtered = visibleCount !== totalCount;

  function togglePanel(next: Exclude<Panel, null>) {
    if (panel === next) {
      setPanel(null);
      return;
    }
    const trigger = (next === 'filters' ? filterTrigger.current : sortTrigger.current)?.querySelector(
      'button',
    );
    if (!trigger) return;
    setPosition(
      panelPosition(trigger, next === 'filters' ? 340 : 240, next === 'filters' ? 240 : 260, next === 'sort'),
    );
    setPanel(next);
  }

  function closePanel(restoreFocus = false) {
    const closed = panel;
    setPanel(null);
    if (restoreFocus)
      requestAnimationFrame(() =>
        (closed === 'sort' ? sortTrigger.current : filterTrigger.current)?.querySelector('button')?.focus(),
      );
  }

  useLayoutEffect(() => {
    if (!panel) return;
    const selector =
      panel === 'filters' ? '[role="combobox"]' : '[role="menuitemradio"][aria-checked="true"]';
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>(selector)?.focus());
  }, [panel]);

  useEffect(() => {
    if (!panel) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (filterTrigger.current?.contains(target) || sortTrigger.current?.contains(target)) return;
      setPanel(null);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        const closed = panel;
        setPanel(null);
        requestAnimationFrame(() =>
          (closed === 'sort' ? sortTrigger.current : filterTrigger.current)?.querySelector('button')?.focus(),
        );
      }
    };
    const closeOnViewportChange = () => setPanel(null);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', closeOnViewportChange, true);
    window.addEventListener('resize', closeOnViewportChange);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', closeOnViewportChange, true);
      window.removeEventListener('resize', closeOnViewportChange);
    };
  }, [panel]);

  function moveMenuFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    );
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  const popover =
    panel && position ? (
      <div
        ref={panelRef}
        id={`${panelId}-panel`}
        className={styles.membersFilterPopover}
        data-panel={panel}
        style={position}
        role={panel === 'filters' ? 'dialog' : 'menu'}
        aria-label={panel === 'filters' ? 'Bộ lọc thành viên' : 'Sắp xếp thành viên'}
        onKeyDown={panel === 'sort' ? moveMenuFocus : undefined}
      >
        {panel === 'filters' ? (
          <>
            <div className={styles.membersFilterPopoverHeading}>
              <div className={styles.membersFilterPopoverTitle}>
                <span className={styles.membersFilterPopoverIcon}>
                  <SlidersHorizontal size={16} aria-hidden="true" />
                </span>
                <span>
                  <strong>Bộ lọc bài báo</strong>
                  <small>Thu hẹp danh sách theo trạng thái</small>
                </span>
              </div>
              <span className={styles.membersFilterPopoverStatus}>
                {activeFilterCount ? `${activeFilterCount} đang dùng` : 'Tất cả'}
              </span>
            </div>
            <div className={styles.membersFilterFields}>
              <Select
                label="Trạng thái thu thập"
                size="sm"
                value={retrievalFilter}
                onChange={(event) => onRetrievalFilterChange(event.target.value)}
              >
                <option value="all">Mọi trạng thái</option>
                <option value="retrieved">Đã lấy</option>
                <option value="sought">Đang tìm</option>
                <option value="not_retrieved">Không lấy được</option>
              </Select>
              <Select
                label="Trạng thái đọc"
                size="sm"
                value={readFilter}
                onChange={(event) => onReadFilterChange(event.target.value)}
              >
                <option value="all">Mọi trạng thái</option>
                <option value="FULL_TEXT">Toàn văn</option>
                <option value="ABSTRACT_ONLY">Abstract</option>
                <option value="METADATA_ONLY">Siêu dữ liệu</option>
              </Select>
            </div>
          </>
        ) : (
          SORT_OPTIONS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant="ghost"
              role="menuitemradio"
              aria-checked={sort === option.value}
              className={styles.membersSortOption}
              onClick={() => {
                onSortChange(option.value);
                closePanel(true);
              }}
            >
              <span>{option.label}</span>
              {sort === option.value && <Check size={15} aria-hidden="true" />}
            </Button>
          ))
        )}
      </div>
    ) : null;

  return (
    <>
      <div className={`${styles.membersFilters} ${activeFilterCount ? styles.membersFiltersWithChips : ''}`}>
        <div className={styles.membersToolbarControls}>
          <div className={styles.membersFilterSearch}>
            <Search size={16} aria-hidden="true" />
            <TextField
              label="Tìm bài"
              hideLabel
              size="sm"
              type="search"
              placeholder="Tìm theo tiêu đề, DOI hoặc mã bài"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              controlClassName={styles.memberSearchInput}
            />
            {query && (
              <Button
                size="sm"
                variant="ghost"
                className={styles.memberSearchClear}
                aria-label="Xóa nội dung tìm kiếm"
                onClick={() => onQueryChange('')}
              >
                <X size={15} aria-hidden="true" />
              </Button>
            )}
          </div>
          <span ref={filterTrigger} className={styles.membersToolbarTrigger}>
            <Button
              size="sm"
              variant={activeFilterCount ? 'primary' : 'secondary'}
              className={styles.membersToolbarButton}
              aria-haspopup="dialog"
              aria-controls={`${panelId}-panel`}
              aria-expanded={panel === 'filters'}
              onClick={() => togglePanel('filters')}
              leadingIcon={<SlidersHorizontal size={15} aria-hidden="true" />}
            >
              Bộ lọc{activeFilterCount ? ` (${activeFilterCount})` : ''}
              <ChevronDown size={15} aria-hidden="true" />
            </Button>
          </span>
          <span className={styles.membersFilterCount} aria-live="polite">
            {filtered ? `${visibleCount} / ${totalCount} bài` : `${totalCount} bài`}
          </span>
          <span ref={sortTrigger} className={`${styles.membersToolbarTrigger} ${styles.membersSortTrigger}`}>
            <Button
              size="sm"
              className={styles.membersToolbarButton}
              aria-haspopup="menu"
              aria-controls={`${panelId}-panel`}
              aria-expanded={panel === 'sort'}
              aria-label={`Sắp xếp. Hiện tại: ${SORT_OPTIONS.find((option) => option.value === sort)?.label ?? 'Thứ tự ban đầu'}`}
              onClick={() => togglePanel('sort')}
              leadingIcon={<ArrowUpDown size={15} aria-hidden="true" />}
            >
              Sắp xếp
              <ChevronDown size={15} aria-hidden="true" />
            </Button>
          </span>
        </div>
      </div>
      {activeFilterCount > 0 && (
        <div className={styles.membersActiveFilters} aria-label="Bộ lọc đang áp dụng">
          {retrievalFilter !== 'all' && (
            <Button
              size="sm"
              variant="ghost"
              className={styles.membersFilterChip}
              aria-label={`Bỏ lọc thu thập: ${RETRIEVAL_LABELS[retrievalFilter]}`}
              onClick={() => onRetrievalFilterChange('all')}
            >
              Thu thập: {RETRIEVAL_LABELS[retrievalFilter]} <X size={13} aria-hidden="true" />
            </Button>
          )}
          {readFilter !== 'all' && (
            <Button
              size="sm"
              variant="ghost"
              className={styles.membersFilterChip}
              aria-label={`Bỏ lọc trạng thái đọc: ${READ_LABELS[readFilter]}`}
              onClick={() => onReadFilterChange('all')}
            >
              Đọc: {READ_LABELS[readFilter]} <X size={13} aria-hidden="true" />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className={styles.membersClearFilters}
            onClick={() => {
              onRetrievalFilterChange('all');
              onReadFilterChange('all');
            }}
          >
            Xóa bộ lọc
          </Button>
        </div>
      )}
      {popover && createPortal(popover, document.body)}
    </>
  );
}
