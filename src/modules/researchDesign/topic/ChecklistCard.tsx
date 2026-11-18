import { Card } from '@/shared/ui/Card';
import { evaluateTopicCheck } from '@/core/topicCheck/checks';
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
export function ChecklistCard({ check }: Props) {
  return (
    <Card>
      <h3>Danh sách kiểm tra</h3>
      <ul>
        {evaluateTopicCheck(check).map((item) => (
          <li key={item.id}>
            {labels[item.id]}: {statuses[item.status]}
            {item.reasonCode === 'unknown_total' || item.reasonCode === 'unknown_impact'
              ? ' · Chưa đủ dữ liệu'
              : ''}
          </li>
        ))}
      </ul>
    </Card>
  );
}
