import { useCallback, useRef, useState } from 'react';
import type { JobFacts, JobId, JobReport, JobReporter } from './paperJobs';

/**
 * What each AI analysis on the paper page reports: the live report (to start a run) and the facts that the
 * page renders, kept unchanged while a report repeats itself so the page does not render again for nothing.
 */
export function useJobReports() {
  const jobs = useRef<Partial<Record<JobId, JobReport>>>({});
  const [jobFacts, setJobFacts] = useState<Partial<Record<JobId, JobFacts>>>({});
  const reportJob = useCallback<JobReporter>((jobId, report) => {
    if (report) jobs.current[jobId] = report;
    else delete jobs.current[jobId];
    setJobFacts((old) => {
      const before = old[jobId];
      if (!report) {
        if (!before) return old;
        const next = { ...old };
        delete next[jobId];
        return next;
      }
      if (
        before &&
        before.running === report.running &&
        before.done === report.done &&
        JSON.stringify(before.stale) === JSON.stringify(report.stale) &&
        before.estimate === report.estimate &&
        before.budget === report.budget &&
        before.ready === report.ready &&
        before.startable === (report.start !== null) &&
        JSON.stringify(before.sections) === JSON.stringify(report.sectionRun?.sections ?? [])
      )
        return old;
      const { running, done, estimate, budget, ready, stale } = report;
      return {
        ...old,
        [jobId]: {
          running,
          done,
          estimate,
          budget,
          ready,
          stale,
          startable: report.start !== null,
          sections: report.sectionRun?.sections ?? [],
        },
      };
    });
  }, []);
  return { jobs, jobFacts, reportJob };
}
