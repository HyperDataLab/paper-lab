import { useMemo, useState } from 'react';
import { useAuth } from '@/shared/auth/authContext';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { createGrobidQueue, type GrobidQueueStatus } from './grobidQueue';

export function useGrobidQueue() {
  const repo = useRepositories();
  const { user, ready, getIdToken } = useAuth();
  const [statuses, setStatuses] = useState<Record<string, GrobidQueueStatus>>({});
  const queue = useMemo(
    () =>
      createGrobidQueue(
        repo,
        () => ({ signedIn: ready && Boolean(user), getIdToken }),
        (id, status) => {
          setStatuses((old) => ({ ...old, [id]: status }));
        },
      ),
    [repo, ready, user, getIdToken],
  );
  return { statuses, enqueue: queue.enqueue };
}
