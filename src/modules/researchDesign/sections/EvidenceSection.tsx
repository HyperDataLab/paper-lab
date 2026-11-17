import { Empty, Loading } from '@/shared/ui/StateNote';
import { useResearchDesign } from '../ResearchDesignProvider';
import { EvidenceView } from '../evidence/EvidenceView';

export default function EvidenceSection() {
  const state = useResearchDesign();
  if (state.loading) return <Loading label="Đang tải bảng so sánh…" />;
  if (state.error) return <Empty title="Không tải được bảng so sánh." hint="Tải lại trang để thử lại." />;
  return <EvidenceView state={state} />;
}
