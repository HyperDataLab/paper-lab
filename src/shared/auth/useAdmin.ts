import { useEffect, useState } from 'react';
import { getMe } from '@/shared/pdfStore/factRequests';
import { useAuth } from './authContext';

// One /v1/me call per signed-in account, shared by every screen that asks (the sidebar is mounted twice).
const answers = new Map<string, Promise<boolean>>();

/** Test helper: forget what the server said. */
export function resetAdminCache() {
  answers.clear();
}

function askServer(uid: string, getIdToken: () => Promise<string | null>) {
  let answer = answers.get(uid);
  if (!answer) {
    answer = (async () => {
      const token = await getIdToken();
      if (!token) throw new Error('No token');
      return (await getMe(token)).admin;
    })().catch(() => {
      // A failed check is "not admin" now and is asked again next time.
      answers.delete(uid);
      return false;
    });
    answers.set(uid, answer);
  }
  return answer;
}

/**
 * Whether the lab server counts the signed-in account as a PaperLab admin. Signed out, or any failure, is not
 * admin. `checking` is true until the answer for the current account is known, so nothing flashes meanwhile.
 */
export function useAdmin() {
  const { user, ready, getIdToken } = useAuth();
  const uid = user?.uid ?? null;
  const [answer, setAnswer] = useState<{ uid: string; admin: boolean } | null>(null);
  useEffect(() => {
    if (!uid) {
      answers.clear();
      return;
    }
    let live = true;
    void askServer(uid, getIdToken).then((admin) => {
      if (live) setAnswer({ uid, admin });
    });
    return () => {
      live = false;
    };
  }, [uid, getIdToken]);
  const known = uid !== null && answer?.uid === uid;
  return { admin: known && answer?.admin === true, checking: !ready || (uid !== null && !known) };
}
