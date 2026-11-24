import type { Analysis, Finding, Paper, PaperChecksRecord } from '@/core/schemas';
import type { FindingInputs } from '@/core/paperFindings';
import type { DimensionId } from '@/core/paperProfile';
import type { Criterion } from './criteria';
import { IssuesBlock, type IssuesKit } from './IssuesBlock';
import { PaperArguments } from './PaperArguments';
import { PaperAtomics } from './PaperAtomics';
import { PaperBlock, type BlockKit } from './PaperBlock';
import type { JobId } from './paperJobs';
import { PaperMeasurement } from './PaperMeasurement';
import type { ViewId } from './paperPlaces';
import { PaperReview } from './PaperReview';
import { PaperRhetoric } from './PaperRhetoric';
import { PaperSummary, type SummaryPart } from './PaperSummary';
import { SpaceOverview } from './SpaceOverview';
import styles from './page.module.css';

const ARGUMENT_DIMENSIONS: DimensionId[] = ['science', 'argument'];
const ARGUMENT_CRITERIA: Criterion[] = ['claim', 'evidence'];
const GAP_SUMMARY: SummaryPart[] = ['question'];
const CLAIMS_SUMMARY: SummaryPart[] = ['claims', 'limits'];

/** The Arguments space: what the paper claims, on what grounds, and how it was measured and reviewed. */
export function ArgumentsSpace({
  active,
  paper,
  kit,
  issues,
  analyses,
  checks,
  insights,
  measurements,
  shown,
  onLocation,
  onOpen,
}: {
  active: boolean;
  paper: Paper;
  kit: BlockKit;
  issues: IssuesKit;
  analyses: Analysis[];
  checks?: PaperChecksRecord;
  insights?: FindingInputs['insights'];
  measurements?: FindingInputs['measurements'];
  /** Whether an analysis's panel is mounted. */
  shown: (job: JobId) => boolean;
  onLocation: (location: Finding['locations'][number]) => void;
  onOpen: (view: ViewId) => void;
}) {
  const open = (id: 'gap' | 'mainClaims' | 'atomics') => active && kit.openBlocks.includes(id);
  return (
    <div hidden={!active} className={styles.blocks}>
      {active && (
        <SpaceOverview
          paper={paper}
          analyses={analyses}
          checks={checks}
          jobFacts={kit.jobFacts}
          onOpen={onOpen}
          only={ARGUMENT_DIMENSIONS}
          label="Arguments overview"
        />
      )}
      <PaperBlock id="arguments" kit={kit}>
        {shown('arguments') && (
          <PaperArguments
            paper={paper}
            view={kit.viewOf('arguments') === 'aif' ? 'aif' : 'toulmin'}
            onLocation={onLocation}
          />
        )}
      </PaperBlock>
      <IssuesBlock id="argIssues" only={ARGUMENT_CRITERIA} visible={active} kit={kit} issues={issues} />
      <PaperBlock id="gap" kit={kit}>
        {open('gap') && (
          <PaperSummary
            paper={paper}
            insights={insights}
            onLocation={onLocation}
            onOpen={onOpen}
            only={GAP_SUMMARY}
          />
        )}
      </PaperBlock>
      <PaperBlock id="mainClaims" kit={kit}>
        {open('mainClaims') && (
          <PaperSummary
            paper={paper}
            insights={insights}
            onLocation={onLocation}
            onOpen={onOpen}
            only={CLAIMS_SUMMARY}
          />
        )}
      </PaperBlock>
      <PaperBlock id="atomics" kit={kit}>
        {open('atomics') && (
          <PaperAtomics
            paper={paper}
            record={measurements}
            onLocation={onLocation}
            onOpen={() => onOpen('measure')}
          />
        )}
      </PaperBlock>
      <PaperBlock id="measure" kit={kit}>
        {shown('measure') && <PaperMeasurement paper={paper} onLocation={onLocation} />}
      </PaperBlock>
      <PaperBlock id="review" kit={kit}>
        {shown('review') && <PaperReview paper={paper} checks={checks} onLocation={onLocation} />}
      </PaperBlock>
      <PaperBlock id="rhetoric" kit={kit}>
        {shown('rhetoric') && (
          <PaperRhetoric
            paper={paper}
            focus={kit.viewOf('rhetoric') === 'moves' ? 'moves' : 'reporting'}
            onLocation={onLocation}
          />
        )}
      </PaperBlock>
    </div>
  );
}
