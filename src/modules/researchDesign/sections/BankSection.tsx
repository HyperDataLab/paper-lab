import { Empty, Loading } from '@/shared/ui/StateNote';
import { BankPanel } from '../bank/BankPanel';
import { useResearchDesign } from '../ResearchDesignProvider';

export default function BankSection() {
  const state = useResearchDesign();
  if (state.loading) return <Loading label="Đang tải bản chụp…" />;
  if (state.error) return <Empty title="Không tải được bản chụp." hint={state.error.message} />;
  return <BankPanel projectId={state.project.id} bank={state.bank} importBank={state.importBank} />;
}
