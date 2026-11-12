import type { Corpus, CorpusMember } from '../schemas/corpus';

export function doiExport(members: CorpusMember[]): string {
  const dois = members
    .filter((m) => m.retrieval !== 'retrieved')
    .map((m) => m.identifiers.doi)
    .filter((doi): doi is string => Boolean(doi));
  return dois.join('\n') + (dois.length ? '\n' : '');
}

export function isStale(member: CorpusMember, current: CorpusMember['inputs']): boolean {
  return member.inputs !== null && JSON.stringify(member.inputs) !== JSON.stringify(current);
}

export function startQueue(corpus: Corpus): Corpus {
  return {
    ...corpus,
    buildQueue: {
      status: 'running',
      pending: corpus.members
        .filter((m) => m.retrieval === 'retrieved' && m.identifiers.paperIds.length > 0)
        .map((m) => m.memberId),
      failed: [],
    },
  };
}

export function checkpoint(
  corpus: Corpus,
  memberId: string,
  inputs: CorpusMember['inputs'],
  reason?: string,
): Corpus {
  if (!corpus.buildQueue || corpus.buildQueue.pending[0] !== memberId)
    throw new Error('Invalid queue checkpoint');
  const pending = corpus.buildQueue.pending.slice(1);
  return {
    ...corpus,
    members: corpus.members.map((m) => (m.memberId === memberId && !reason ? { ...m, inputs } : m)),
    buildQueue: {
      ...corpus.buildQueue,
      pending,
      failed: reason ? [...corpus.buildQueue.failed, { memberId, reason }] : corpus.buildQueue.failed,
      status: pending.length ? 'running' : 'complete',
    },
  };
}
