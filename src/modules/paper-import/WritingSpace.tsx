import type { Finding, Paper, PaperChecksRecord } from '@/core/schemas';
import { BatchPanel } from './BatchPanel';
import { IssuesBlock, type IssuesKit } from './IssuesBlock';
import { PaperBlock, type BlockKit } from './PaperBlock';
import type { JobId } from './paperJobs';
import { PaperOverview } from './PaperOverview';
import type { ViewId } from './paperPlaces';
import { PaperProbe } from './PaperProbe';
import { PaperStance } from './PaperStance';
import { PaperVocabulary } from './PaperVocabulary';
import { SpaceOverview } from './SpaceOverview';
import type { useBatchRun } from './useBatchRun';
import styles from './page.module.css';

/** The Writing style space: how the paper is organised and worded, and how stable the AI's scores are. */
export function WritingSpace({
  active,
  paper,
  kit,
  issues,
  batch,
  checks,
  shown,
  onLocation,
  onOpen,
  onFilter,
}: {
  active: boolean;
  paper: Paper;
  kit: BlockKit;
  issues: IssuesKit;
  batch: ReturnType<typeof useBatchRun>;
  checks?: PaperChecksRecord;
  /** Whether an analysis's panel is mounted. */
  shown: (job: JobId) => boolean;
  onLocation: (location: Finding['locations'][number]) => void;
  onOpen: (view: ViewId) => void;
  /** Shows the paper limited to these paragraphs. */
  onFilter: (ids: string[]) => void;
}) {
  return (
    <div hidden={!active} className={styles.blocks}>
      {active && (
        <SpaceOverview
          paper={paper}
          analyses={batch.analyses}
          checks={checks}
          jobFacts={kit.jobFacts}
          onOpen={onOpen}
          only={['discourse', 'writing']}
          label="Writing overview"
        />
      )}
      <IssuesBlock id="writingIssues" only={['writing']} visible={active} kit={kit} issues={issues} />
      <PaperBlock id="batch" kit={kit}>
        <>
          {shown('batch') && <BatchPanel paper={paper} batch={batch} />}
          {active && kit.openBlocks.includes('batch') && (
            <PaperOverview
              paper={paper}
              analyses={batch.analyses}
              run={batch.run}
              focus={kit.viewOf('batch') === 'organization' ? 'discourse' : 'writing'}
              onFilter={onFilter}
            />
          )}
        </>
      </PaperBlock>
      <PaperBlock id="stance" kit={kit}>
        {shown('stance') && <PaperStance paper={paper} onLocation={onLocation} />}
      </PaperBlock>
      <PaperBlock id="vocabulary" kit={kit}>
        {active && kit.openBlocks.includes('vocabulary') && (
          <PaperVocabulary paper={paper} onLocation={onLocation} />
        )}
      </PaperBlock>
      <PaperBlock id="probe" kit={kit}>
        {shown('probe') && <PaperProbe paper={paper} analyses={batch.analyses} />}
      </PaperBlock>
    </div>
  );
}
