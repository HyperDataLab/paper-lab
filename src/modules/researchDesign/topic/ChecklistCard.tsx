import { evaluateTopicCheck } from '@/core/topicCheck/checks';
import { useEffect, useState } from 'react';
import { Button } from '@/shared/ui/Button';
import type { Props } from './types';
const labels: Record<string, string> = {
  statement: 'Phát biểu đề tài (gợi ý)',
  neighbours: 'Bài gần nhất',
  debate: 'Tranh luận (gợi ý)',
  convergence: 'Điểm hội tụ (gợi ý)',
  duplication: 'Evidence trùng lặp',
  feasibility: 'Tính khả thi (gợi ý)',
  impact: 'Tác động (gợi ý)',
  pico: 'PICO',
  plainSummary: 'Giải thích dễ hiểu (gợi ý)',
};
const statuses = {
  missing: 'Còn thiếu',
  needs_work: 'Cần xem lại',
  ready: 'Đã có',
  not_applicable: 'Không áp dụng',
};
const targets: Record<string, string> = {
  statement: 'topic-statement',
  neighbours: 'topic-neighbours',
  debate: 'topic-debate',
  convergence: 'topic-feasibility',
  duplication: 'topic-search-query',
  feasibility: 'topic-feasibility',
  impact: 'topic-search-query',
  pico: 'topic-pico',
  plainSummary: 'topic-summary',
};

export function ChecklistCard({ check }: Pick<Props, 'check'>) {
  const [open, setOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1200px)').matches === true,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(min-width: 1200px)');
    const syncToViewport = (event: MediaQueryListEvent) => setOpen(event.matches);
    media.addEventListener('change', syncToViewport);
    return () => media.removeEventListener('change', syncToViewport);
  }, []);
  const items = evaluateTopicCheck(check);
  const readyCount = items.filter((item) => item.status === 'ready').length;
  return (
    <details open={open} className="topic-checklist" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>Checklist đề tài</span>
        <small>
          {readyCount}/{items.length} đã có
        </small>
      </summary>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <Button
              variant="ghost"
              className="topic-checklist-item"
              type="button"
              onClick={() => {
                const target = document.getElementById(targets[item.id] ?? 'topic-statement');
                if (!target) return;
                if (typeof target.scrollIntoView === 'function') {
                  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                target.focus();
              }}
            >
              <span>{labels[item.id]}</span>
              <strong data-status={item.status}>{statuses[item.status]}</strong>
            </Button>
            {(item.reasonCode === 'unknown_total' || item.reasonCode === 'unknown_impact') && (
              <small>Chưa đủ dữ liệu</small>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
