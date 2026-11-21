import type { ComponentType } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { Empty } from '@/shared/ui/StateNote';
import { useResearchDesign } from './ResearchDesignProvider';
import { AutoResearchCandidates } from './AutoResearchCandidates';

/** Shows the selected section, or the area's load error with a way to read everything again. */
export function SectionBody({ section: Section, sectionId }: { section: ComponentType; sectionId?: string }) {
  const state = useResearchDesign();
  if (!state.loading && state.error)
    return (
      <Empty title="Không tải được research design." hint={state.error.message}>
        <Button leadingIcon={<RefreshCw size={16} aria-hidden="true" />} onClick={() => void state.reload()}>
          Thử lại
        </Button>
      </Empty>
    );
  return (
    <>
      <Section />
      {sectionId && <AutoResearchCandidates section={sectionId} />}
    </>
  );
}
