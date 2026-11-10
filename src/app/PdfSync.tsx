import { useEffect } from 'react';
import { useAuth } from '@/shared/auth/authContext';
import { syncPendingPdfs } from '@/shared/pdfStore';
import { useRepositories } from '@/shared/storage/StorageProvider';

/** When a lab account signs in, PDFs kept only on this machine are sent to the lab's storage. */
export function PdfSync() {
  const repo = useRepositories();
  const { user, getIdToken } = useAuth();
  useEffect(() => {
    if (!user) return;
    void syncPendingPdfs(repo, getIdToken).catch(() => undefined);
  }, [user, repo, getIdToken]);
  return null;
}
