import { useEffect } from 'react';
import { useAuth } from '@/shared/auth/authContext';
import { syncPendingPdfs } from '@/shared/pdfStore';
import { useHubProjectId, useRepositories } from '@/shared/storage/StorageProvider';

/** When a lab account signs in, pending local PDFs are sent to the active ResearchHub project. */
export function PdfSync() {
  const repo = useRepositories();
  const projectId = useHubProjectId();
  const { user, getIdToken } = useAuth();
  useEffect(() => {
    if (!user) return;
    void syncPendingPdfs(repo, projectId, getIdToken).catch(() => undefined);
  }, [user, projectId, repo, getIdToken]);
  return null;
}
