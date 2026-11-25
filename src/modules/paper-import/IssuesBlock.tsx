import type { Finding, Paper } from '@/core/schemas';
import type { FindingStatus, PaperFinding } from '@/core/paperFindings';
import { useCallback, useMemo } from 'react';
import type { Criterion } from './criteria';
import { FindingsList } from './FindingsList';
import { PaperBlock, type BlockKit } from './PaperBlock';
import type { BlockId, ViewId } from './paperPlaces';

/** What a list of findings needs from the paper page. */
export interface IssuesKit {
  paper: Paper;
  findings: PaperFinding[];
  onLocation: (location: Finding['locations'][number]) => void;
  onOpenSource: (view: ViewId) => void;
  onDecide: (finding: PaperFinding, status: FindingStatus) => void;
  onRunChecks: () => void;
}

/** The rule checks whose findings belong to each issues block, beside the criteria it is about. */
const CHECK_VIEWS: Partial<Record<BlockId, ViewId[]>> = {
  argIssues: ['science-checks'],
  writingIssues: ['discourse-checks', 'writing-checks'],
  citationIssues: ['context-checks'],
};

/** The findings of some criteria, as a folding block in the place that is about them. */
export function IssuesBlock({
  id,
  only,
  visible,
  kit,
  issues,
  idPrefix,
}: {
  id: BlockId;
  only: Criterion[];
  visible: boolean;
  kit: BlockKit;
  issues: IssuesKit;
  idPrefix?: string;
}) {
  const own = useMemo(
    () =>
      issues.findings.filter(
        (item) =>
          only.includes(item.criterion) ||
          (item.source === 'checks' && CHECK_VIEWS[id]?.includes(item.view as ViewId)),
      ),
    [id, issues.findings, only],
  );
  const onOpenSourceView = issues.onOpenSource;
  const onOpenSource = useCallback((view: string) => onOpenSourceView(view as ViewId), [onOpenSourceView]);
  return (
    <PaperBlock id={id} kit={kit} title={`Issues (${own.length})`}>
      {visible && kit.openBlocks.includes(id) && (
        <FindingsList
          paper={issues.paper}
          findings={own}
          only={only}
          focusId={null}
          onLocation={issues.onLocation}
          onOpenSource={onOpenSource}
          onDecide={issues.onDecide}
          onRunChecks={issues.onRunChecks}
          idPrefix={idPrefix}
        />
      )}
    </PaperBlock>
  );
}
