import type { Paper } from '@/core/schemas';
import type { Repositories } from '@/shared/storage/repositories';
import { paperSha } from './index';
import { requestGrobid } from './grobidSync';

export type GrobidQueueStatus = {
  status: 'queued' | 'running' | 'ready' | 'failed' | 'waiting';
  reason?: string;
};

export function createGrobidQueue(
  repo: Repositories,
  projectId: string | null,
  auth: () => { signedIn: boolean; getIdToken: () => Promise<string | null> },
  update: (id: string, status: GrobidQueueStatus) => void,
) {
  const pending: { id: string; paper: Paper }[] = [];
  let running = 0;
  function pump() {
    while (running < 2 && pending.length) {
      const item = pending.shift();
      if (!item) break;
      running++;
      void process(item).finally(() => {
        running--;
        pump();
      });
    }
  }
  async function process({ id, paper }: { id: string; paper: Paper }) {
    try {
      const previous = await repo.grobid.get(paper.id);
      if (previous?.status === 'ready' && previous.result && previous.sha256 === paperSha(paper)) {
        update(id, { status: 'ready' });
        return;
      }
      const session = auth();
      if (!session.signedIn) {
        update(id, { status: 'waiting' });
        return;
      }
      update(id, { status: 'running' });
      if (!projectId) {
        update(id, { status: 'failed', reason: 'ResearchHub project is required' });
        return;
      }
      const record = await requestGrobid(repo, paper, projectId, session.getIdToken);
      update(
        id,
        record.status === 'ready' && record.result
          ? { status: 'ready' }
          : { status: 'failed', reason: record.error ?? 'Không có dữ liệu dùng được' },
      );
    } catch (cause) {
      update(id, { status: 'failed', reason: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return {
    enqueue(id: string, paper: Paper) {
      update(id, { status: 'queued' });
      pending.push({ id, paper });
      pump();
    },
  };
}
