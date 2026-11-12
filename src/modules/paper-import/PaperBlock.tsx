import type { ReactNode } from 'react';
import type { JobFacts, JobId } from './paperJobs';
import { BLOCKS, VIEW_HELP, type BlockId, type ViewId } from './paperPlaces';
import { SectionBlock, type BlockStatus } from './SectionBlock';

/** What every block of the paper page needs from the page: run state, what is open, and how to act. */
export interface BlockKit {
  jobFacts: Partial<Record<JobId, JobFacts>>;
  openBlocks: BlockId[];
  viewOf: (id: BlockId) => ViewId;
  sectionLabel: (sectionId: string) => string;
  onView: (view: ViewId) => void;
  onToggle: (id: BlockId) => void;
  /** Opens the block and starts its analysis. */
  onStart: (id: BlockId, job: JobId) => void;
  onRunSection: (job: JobId, sectionId: string) => void;
}

/** One analysis as a folding block. `children` is rendered by the caller so kept panels stay mounted. */
export function PaperBlock({
  id,
  kit,
  title,
  children,
}: {
  id: BlockId;
  kit: BlockKit;
  title?: string;
  children: ReactNode;
}) {
  const def = BLOCKS[id];
  const fact = def.job ? kit.jobFacts[def.job] : undefined;
  const status: BlockStatus | undefined = !def.job
    ? undefined
    : !fact?.ready
      ? 'loading'
      : fact.running
        ? 'running'
        : fact.done
          ? 'done'
          : 'todo';
  const job = def.job;
  return (
    <SectionBlock
      id={id}
      title={title ?? def.title}
      help={VIEW_HELP[kit.viewOf(id)]}
      criterion={def.criterion}
      status={status}
      stale={fact?.stale}
      sectionRun={
        job && fact && !fact.running && fact.sections.length > 0
          ? {
              sections: fact.sections.map((choice) => ({ ...choice, label: kit.sectionLabel(choice.id) })),
              onRun: (sectionId: string) => kit.onRunSection(job, sectionId),
            }
          : undefined
      }
      estimate={fact?.estimate}
      budget={fact?.budget}
      onRun={
        job && (status === 'todo' || Boolean(fact?.stale)) && fact?.startable
          ? () => kit.onStart(id, job)
          : undefined
      }
      open={kit.openBlocks.includes(id)}
      onToggle={() => kit.onToggle(id)}
      views={def.views}
      view={kit.viewOf(id)}
      onView={(view) => kit.onView(view as ViewId)}
    >
      {children}
    </SectionBlock>
  );
}
