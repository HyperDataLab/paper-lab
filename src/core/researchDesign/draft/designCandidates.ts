import type { Draft } from './schema';

export function confirmDesignCandidate(draft: Draft, designHash: string, id: string): Draft {
  const proposal = draft.autoresearchDesign;
  if (!proposal || proposal.context.designHash !== designHash) throw new Error('Design candidate changed');
  if (!proposal.candidates.some((row) => row.id === id && row.status === 'candidate')) return draft;
  return {
    ...draft,
    autoresearchDesign: {
      ...proposal,
      candidates: proposal.candidates.map((row) => (row.id === id ? { ...row, status: 'accepted' } : row)),
    },
  };
}
