import type { Analysis, Paper, PaperChecksRecord } from '@/core/schemas';
import type { DimensionId } from '@/core/paperProfile';
import type { JobFacts, JobId } from './paperJobs';
import { JOB_IDS, type ViewId } from './paperPlaces';
import { PaperProfile } from './PaperProfile';

/** The profile's dimensions that answer what a tab or space is about, read again when an analysis ends. */
export function SpaceOverview({
  paper,
  analyses,
  checks,
  jobFacts,
  onOpen,
  only,
  label,
}: {
  paper: Paper;
  analyses: Analysis[];
  checks?: PaperChecksRecord;
  jobFacts: Partial<Record<JobId, JobFacts>>;
  onOpen: (view: ViewId) => void;
  only: DimensionId[];
  label: string;
}) {
  return (
    <PaperProfile
      key={JOB_IDS.filter((job) => jobFacts[job]?.done).join(',')}
      paper={paper}
      analyses={analyses}
      checks={checks}
      onOpen={onOpen}
      only={only}
      label={label}
    />
  );
}
