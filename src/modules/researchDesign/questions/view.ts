import type { DraftHypothesis } from '@/core/researchDesign/draft/schema';
import type { BankClaimType } from '@/core/researchDesign/bank/snapshot';

export const kinds: Record<DraftHypothesis['kind'], string> = {
  directional: 'Có hướng',
  non_directional: 'Không hướng',
  equivalence: 'Tương đương',
  exploratory: 'Thăm dò',
};

export function claimLabel(id: string | null, claims: BankClaimType[]): string {
  if (!id) return 'Chưa phân loại claim';
  const claim = claims.find((entry) => entry.id === id);
  return claim ? `${claim.name}${claim.status === 'draft' ? ' · Bản nháp' : ''}` : id;
}
