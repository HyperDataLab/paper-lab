import { createContext, useContext, useEffect } from 'react';

/** The AI analyses of one paper. Each one is a panel that stays mounted while the reader visits other tabs. */
export type JobId =
  'snapshot' | 'measure' | 'rhetoric' | 'arguments' | 'batch' | 'stance' | 'probe' | 'review';

export interface JobReport {
  running: boolean;
  /** A finished result exists and nothing is waiting to be resumed. */
  done: boolean;
  /** AI calls a fresh run is expected to make with the current scope. */
  estimate: number;
  /** False while the panel is still loading what was saved. */
  ready: boolean;
  /** Starts a fresh run with the current scope and ceiling; null when the analysis needs the reader first. */
  start: (() => Promise<unknown>) | null;
}

export type JobReporter = (id: JobId, report: JobReport | null) => void;

/** Absent when a panel is rendered on its own, as in tests; the panel then simply reports to nobody. */
export const JobsContext = createContext<JobReporter | null>(null);

/** Tells the paper page what this analysis is doing, so it can show running work and start it from outside. */
export function useReportJob(id: JobId, report: JobReport) {
  const send = useContext(JobsContext);
  // Every render: the start function closes over the latest scope and ceiling.
  useEffect(() => {
    send?.(id, report);
  });
  useEffect(() => () => send?.(id, null), [send, id]);
}
