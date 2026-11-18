import { findClaimType, findDesign } from '@/core/researchDesign/bank/readSnapshot';
import type { BankDoc } from '@/core/researchDesign/bank/snapshot';
import type { DesignFlag } from '@/core/researchDesign/draft/checkDesign';
import type { Draft } from '@/core/researchDesign/draft/schema';

export function flagText(flag: DesignFlag, draft: Draft, bank: BankDoc | null): string {
  switch (flag.rule) {
    case 'DS-01':
      return `${flag.subject} là claim ${findClaimType(bank, flag.claim)?.name ?? flag.claim}; research design «${findDesign(bank, flag.design)?.name ?? draft.design?.name ?? flag.design}» không hỗ trợ loại claim này.`;
    case 'DS-02':
      return `${flag.subject} chưa có loại claim cho research design «${draft.design?.name ?? ''}».`;
    case 'DS-03':
      return `Research design «${draft.design?.name ?? ''}» chưa có cách phân nhóm.`;
    case 'DS-04':
      return `${flag.subject} «${draft.threats.find((t) => t.id === flag.subject)?.name ?? ''}» chưa ghi cách giảm.`;
    case 'DS-05': {
      const object =
        flag.reference === 'design'
          ? `Research design «${draft.design?.name ?? flag.id}» (${flag.id})`
          : flag.reference === 'threat'
            ? `${flag.subject} «${draft.threats.find((t) => t.id === flag.subject)?.name ?? ''}»: mục ${flag.id}`
            : flag.reference === 'claim'
              ? `${flag.subject}: loại claim ${flag.id}`
              : `${flag.subject} «${(flag.reference === 'benchmark' ? draft.datasets : draft.metrics).find((item) => item.id === flag.subject)?.name ?? ''}»: mục ${flag.id}`;
      const reason =
        flag.reason === 'no_snapshot'
          ? 'chưa đối chiếu được vì dự án chưa có bản chụp Writing Bank'
          : flag.reason === 'other_release'
            ? 'thuộc bản chụp cũ'
            : 'không còn trong bản chụp hiện tại';
      return `${object} ${reason}.`;
    }
  }
}
