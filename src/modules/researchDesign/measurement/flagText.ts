import type { ChainFlag } from '@/core/researchDesign/draft/checkChain';
import type { DesignFlag } from '@/core/researchDesign/draft/checkDesign';
import type { Draft } from '@/core/researchDesign/draft/schema';

export const metricFieldWords: Record<string, string> = {
  key: 'key',
  unit: 'đơn vị',
  goal: 'hướng tốt',
  aggregation: 'cách gộp',
  protocol: 'quy trình đo',
};

export function chainFlagText(flag: ChainFlag, draft: Draft): string {
  const named = (items: { id: string; name: string }[]) =>
    `${flag.subject} «${items.find((item) => item.id === flag.subject)?.name ?? ''}»`;
  switch (flag.rule) {
    case 'CH-01':
      return `${flag.subject} chưa gắn biến phụ thuộc.`;
    case 'CH-02':
      return `${named(draft.variables)} là biến phụ thuộc của ${flag.hypothesis} nhưng chưa có metric.`;
    case 'CH-03':
      return `${flag.subject} tham chiếu biến ${flag.variable} ${flag.which === 'missing' ? 'không tồn tại' : 'không đúng vai trò'}.`;
    case 'CH-04':
      return `${named(draft.metrics)} còn thiếu: ${flag.missing.map((field) => metricFieldWords[field] ?? field).join(', ')}.`;
    case 'CH-05':
      return `${named(draft.metrics)} có key ${flag.reason === 'duplicate' ? 'trùng với metric khác' : 'dành riêng cho run tag'}.`;
    case 'CH-06':
      return `${named(draft.variables)} có ít hơn hai mức.`;
    case 'CH-07':
      return `${named(draft.datasets)} chưa có nguồn.`;
    case 'CH-08':
      return `${named(draft.variables)} tham chiếu metric không tồn tại.`;
  }
}

type ReferenceFlag = Extract<DesignFlag, { rule: 'DS-05' }>;

/** DS-05 for a metric, protocol or benchmark reference held by a measurement item. */
export function referenceFlagText(flag: ReferenceFlag, draft: Draft): string {
  const items = flag.reference === 'benchmark' ? draft.datasets : draft.metrics;
  const object = `${flag.subject} «${items.find((item) => item.id === flag.subject)?.name ?? ''}»: mục ${flag.id}`;
  const reason =
    flag.reason === 'no_snapshot'
      ? 'chưa đối chiếu được vì dự án chưa có bản chụp Writing Bank'
      : flag.reason === 'other_release'
        ? 'thuộc bản chụp cũ'
        : 'không còn trong bản chụp hiện tại';
  return `${object} ${reason}.`;
}
