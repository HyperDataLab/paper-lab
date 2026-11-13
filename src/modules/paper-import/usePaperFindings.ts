import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Paper, PaperChecksRecord } from '@/core/schemas';
import { usableGrobid } from '@/core/grobid/merge';
import { runPaperChecks } from '@/core/paperChecks';
import { collectFindings, collectMarks, type FindingInputs } from '@/core/paperFindings';
import { captureCalibration } from '@/shared/calibration/data';
import { useRepositories } from '@/shared/storage/StorageProvider';

/**
 * Everything the paper's analyses have stored, and the findings and marks collected from it. It is read again
 * when an analysis finishes (`doneJobs`), when the reader moves to another place (`place`), and on
 * `notifyStoredChanged`.
 */
export function usePaperFindings({
  id,
  paper,
  doneJobs,
  place,
  onError,
}: {
  id: string | undefined;
  paper: Paper | null;
  doneJobs: string;
  place: string;
  onError: (message: string) => void;
}) {
  const repo = useRepositories();
  const [checks, setChecks] = useState<PaperChecksRecord>();
  // What the analyses have stored, read again whenever one of them finishes or a decision is made here.
  const [stored, setStored] = useState<Omit<FindingInputs, 'paper' | 'checks'>>({});
  const [storedTick, setStoredTick] = useState(0);
  const notifyStoredChanged = useCallback(() => setStoredTick((tick) => tick + 1), []);
  useEffect(() => {
    let active = true;
    if (id)
      void repo.paperChecks
        .get(id)
        .then(async (value) => {
          if (!active) return;
          if (value) return setChecks(value);
          // Nothing checked yet: the rule checks use no AI, so they run on their own when the paper opens.
          const [stored, grobid] = await Promise.all([repo.papers.get(id), repo.grobid.get(id)]);
          if (!stored || !active) return;
          const saved = await repo.paperChecks.save({
            schemaVersion: 1,
            paperId: stored.id,
            report: runPaperChecks(stored, new Date(), usableGrobid(grobid)),
            decisions: [],
            calibrationSnapshot: await captureCalibration(repo),
          });
          if (active) setChecks(saved);
        })
        .catch((cause: unknown) => {
          if (active) onError(String(cause));
        });
    return () => {
      active = false;
    };
  }, [id, repo, storedTick, onError]);
  useEffect(() => {
    let active = true;
    if (!id) return;
    void Promise.all([
      repo.paperReviews.get(id),
      repo.analyses.listByPaper(id),
      repo.paperOverviews.get(id),
      repo.measurements.get(id),
      repo.paperInsights.get(id),
      repo.stance.get(id),
    ])
      .then(([reviews, analyses, overview, measurements, insights, stance]) => {
        if (active) setStored({ reviews, analyses, overview, measurements, insights, stance });
      })
      .catch((cause: unknown) => {
        if (active) onError(String(cause));
      });
    return () => {
      active = false;
    };
    // Entering a mode re-reads too, so a decision made inside a block shows in the list and on the text.
  }, [id, repo, doneJobs, place, storedTick, onError]);
  const findings = useMemo(
    () => (paper ? collectFindings({ paper, checks, ...stored }) : []),
    [paper, checks, stored],
  );
  const marks = useMemo(
    () => (paper ? collectMarks({ paper, checks, ...stored }, findings) : []),
    [paper, checks, stored, findings],
  );
  return { checks, setChecks, stored, findings, marks, notifyStoredChanged };
}
