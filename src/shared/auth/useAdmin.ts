import { useEffect, useState } from 'react';
import { getMe } from '@/shared/pdfStore/factRequests';
import { useHubProjectId } from '@/shared/storage/StorageProvider';
import { useAuth } from './authContext';

// One /v1/me call per signed-in account, shared by every screen that asks (the sidebar is mounted twice).
const answers = new Map<string, Promise<boolean>>();

/** Test helper: forget what the server said. */
export function resetAdminCache() {
  answers.clear();
}

function askServer(uid: string, projectId: string, getIdToken: () => Promise<string | null>) {
  const cacheKey = `${uid}:${projectId}`;
  let answer = answers.get(cacheKey);
  if (!answer) {
    answer = (async () => {
      const token = await getIdToken();
      if (!token) throw new Error('No token');
      return (await getMe(token, projectId)).admin;
    })().catch(() => {
      // A failed check is "not admin" now and is asked again next time.
      answers.delete(cacheKey);
      return false;
    });
    answers.set(cacheKey, answer);
  }
  return answer;
}

/**
 * Whether the lab server counts the signed-in account as a PaperLab admin. Signed out, or any failure, is not
 * admin. `checking` is true until the answer for the current account is known, so nothing flashes meanwhile.
 */
export function useAdmin() {
  const { user, ready, getIdToken } = useAuth();
  const projectId = useHubProjectId();
  const uid = user?.uid ?? null;
  const [answer, setAnswer] = useState<{ uid: string; admin: boolean } | null>(null);
  useEffect(() => {
    if (!uid || !projectId) {
      answers.clear();
      return;
    }
    let live = true;
    void askServer(uid, projectId, getIdToken).then((admin) => {
      if (live) setAnswer({ uid, admin });
    });
    return () => {
      live = false;
    };
  }, [uid, projectId, getIdToken]);
  const known = uid !== null && answer?.uid === uid;
  return { admin: known && answer?.admin === true, checking: !ready || (uid !== null && !known) };
}
