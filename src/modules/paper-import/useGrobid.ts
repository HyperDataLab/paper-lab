import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usableGrobid } from '@/core/grobid/merge';
import type { GrobidRecord, Paper } from '@/core/schemas';
import { useAuth } from '@/shared/auth/authContext';
import { grobidBlocker, requestGrobid } from '@/shared/pdfStore/grobidSync';
import { useHubProjectId, useRepositories } from '@/shared/storage/StorageProvider';
import { GROBID_IDLE, type GrobidState } from './grobidContext';

const fromRecord = (record: GrobidRecord): Omit<GrobidState, 'refetch'> =>
  usableGrobid(record)
    ? { status: 'ready', reason: null, record }
    : { status: 'failed', reason: record.error ?? 'GROBID không trả về dữ liệu dùng được', record };

/**
 * The paper's GROBID structure. A paper with no stored result asks for it in the background once the session
 * is known; a stored failure is not retried on its own, only through `refetch`. `onChanged` runs after a new
 * result is stored, since the citation checks were run again with it.
 */
export function useGrobid(paper: Paper | null, onChanged: () => void): GrobidState {
  const repo = useRepositories();
  const projectId = useHubProjectId();
  const { user, ready, getIdToken } = useAuth();
  const [state, setState] = useState<Omit<GrobidState, 'refetch'>>(GROBID_IDLE);
  const paperRef = useRef(paper);
  const running = useRef<AbortController | null>(null);
  const signedIn = Boolean(user);
  const paperId = paper?.id;
  useEffect(() => {
    paperRef.current = paper;
  }, [paper]);

  const start = useCallback(
    (replace = false) => {
      const current = paperRef.current;
      if (!current) return;
      if (!projectId) {
        setState({ status: 'failed', reason: 'ResearchHub project is required', record: null });
        return;
      }
      const blocker = grobidBlocker(current, signedIn);
      if (blocker) {
        // A result already in use stays in use; only a paper without one shows why nothing was asked.
        setState((old) =>
          usableGrobid(old.record) && old.record?.paperId === current.id
            ? old
            : { status: 'failed', reason: blocker, record: null },
        );
        return;
      }
      running.current?.abort();
      const controller = new AbortController();
      running.current = controller;
      setState((old) => ({
        status: 'loading',
        reason: null,
        record: old.record?.paperId === current.id ? old.record : null,
      }));
      void requestGrobid(repo, current, projectId, getIdToken, controller.signal, replace)
        .then((record) => {
          if (controller.signal.aborted) return;
          setState(fromRecord(record));
          onChanged();
        })
        .catch(() => undefined);
    },
    [repo, projectId, getIdToken, signedIn, onChanged],
  );

  useEffect(() => {
    if (!paperId || !ready) return;
    let active = true;
    void repo.grobid
      .get(paperId)
      .then((record) => {
        if (!active) return;
        if (record) setState(fromRecord(record));
        else start();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      running.current?.abort();
    };
  }, [paperId, ready, repo, start]);

  // Until the new paper's record is read, the previous paper's state is not shown or merged.
  const own = !state.record || state.record.paperId === paperId;
  const refetch = paper ? start : null;
  return useMemo(
    () => (own ? { ...state, refetch } : { ...GROBID_IDLE, refetch }),
    [own, refetch, state],
  );
}
