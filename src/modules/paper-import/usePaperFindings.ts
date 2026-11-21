import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paper, PaperChecksRecord } from '@/core/schemas';
import { usableGrobid } from '@/core/grobid/merge';
import { runPaperChecks } from '@/core/paperChecks';
import { collectFindings, collectMarks, type FindingInputs } from '@/core/paperFindings';
import { captureCalibration } from '@/shared/calibration/data';
import { useHubProjectId, useRepositories } from '@/shared/storage/StorageProvider';

/**
 * Cached paper analyses and the findings/marks collected from them. Switching reader tabs reuses the cache;
 * finished jobs and explicit writes invalidate it so the next view sees the latest records.
 */
export function usePaperFindings({
  id,
  paper,
  doneJobs,
  onError,
}: {
  id: string | undefined;
  paper: Paper | null;
  doneJobs: string;
  onError: (message: string) => void;
}) {
  const repo = useRepositories();
  const projectId = useHubProjectId();
  const queryClient = useQueryClient();
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const checksQuery = useQuery({
    queryKey: ['project', projectId, 'paper-findings', id, 'checks'],
    enabled: Boolean(id),
    queryFn: async () => {
      if (!id) throw new Error('Paper ID is required to load findings.');
      const existing = await repo.paperChecks.get(id);
      if (existing) return existing;
      // Rule checks are local and run once when the paper has no saved check record.
      const [storedPaper, grobid] = await Promise.all([repo.papers.get(id), repo.grobid.get(id)]);
      if (!storedPaper) return undefined;
      return repo.paperChecks.save({
        schemaVersion: 1,
        paperId: storedPaper.id,
        report: runPaperChecks(storedPaper, new Date(), usableGrobid(grobid)),
        decisions: [],
        calibrationSnapshot: await captureCalibration(repo),
      });
    },
  });

  const storedQuery = useQuery({
    // Job completion changes the cache key; switching Issues/Citations does not.
    queryKey: ['project', projectId, 'paper-findings', id, 'stored', doneJobs],
    enabled: Boolean(id),
    queryFn: async () => {
      if (!id) throw new Error('Paper ID is required to load findings.');
      const [reviews, analyses, overview, measurements, insights, stance] = await Promise.all([
        repo.paperReviews.get(id),
        repo.analyses.listByPaper(id),
        repo.paperOverviews.get(id),
        repo.measurements.get(id),
        repo.paperInsights.get(id),
        repo.stance.get(id),
      ]);
      return { reviews, analyses, overview, measurements, insights, stance };
    },
  });

  useEffect(() => {
    const cause = checksQuery.error ?? storedQuery.error;
    if (cause) onErrorRef.current(String(cause));
  }, [checksQuery.error, storedQuery.error]);

  const notifyStoredChanged = useCallback(() => {
    if (!id) return;
    void queryClient.invalidateQueries({ queryKey: ['project', projectId, 'paper-findings', id] });
  }, [id, projectId, queryClient]);
  const checks: PaperChecksRecord | undefined = checksQuery.data;
  const setChecks: Dispatch<SetStateAction<PaperChecksRecord | undefined>> = useCallback(
    (next) => {
      queryClient.setQueryData<PaperChecksRecord | undefined>(
        ['project', projectId, 'paper-findings', id, 'checks'],
        next,
      );
    },
    [id, projectId, queryClient],
  );
  const stored = useMemo<Omit<FindingInputs, 'paper' | 'checks'>>(
    () => storedQuery.data ?? {},
    [storedQuery.data],
  );
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
