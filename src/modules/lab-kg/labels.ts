import type { KgGraphLayer, KgGraphNodeKind } from '@/core/schemas/labKg';

export const LAYER_NAMES: Record<KgGraphLayer, string> = {
  papers: 'Bài báo',
  keywords: 'Keywords',
  authors: 'Tác giả',
  institutions: 'Cơ quan',
  topics: 'Chủ đề',
};

export const KIND_LABELS: Record<KgGraphNodeKind, string> = {
  paper: 'Bài báo',
  keyword: 'Keyword',
  author: 'Tác giả',
  institution: 'Cơ quan',
  topic: 'Chủ đề',
  subfield: 'Phân ngành',
  field: 'Ngành',
  domain: 'Lĩnh vực',
};
