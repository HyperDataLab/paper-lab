import type { KgEdge, KgLayer, KgPredicate, KgProvenance } from '@/core/openkg';

export const LAYER_LABELS: Record<KgLayer, string> = {
  evidential: 'Dẫn chứng',
  conceptual: 'Khái niệm',
  disciplinary: 'Chuyên ngành',
  expertise: 'Chuyên môn',
  normative: 'Đánh giá',
};

export const PREDICATE_LABELS: Record<KgPredicate, string> = {
  cites: 'trích dẫn',
  publishedIn: 'xuất bản tại',
  hasKeyword: 'có từ khóa',
  contributes: 'đóng góp',
  buildsOn: 'dựa trên',
  relatedKeyword: 'liên quan đến từ khóa',
  coAuthor: 'đồng tác giả với',
  inTopic: 'thuộc',
  broader: 'thuộc nhóm rộng hơn',
  authoredBy: 'có tác giả',
  affiliatedWith: 'có cơ quan công tác',
  hasClaim: 'nêu luận điểm',
  supportedBy: 'được củng cố bởi',
  evidenceLevel: 'có mức bằng chứng',
};

export const NODE_LABELS = {
  Paper: 'Bài báo',
  Work: 'Tài liệu được dẫn',
  Source: 'Nơi xuất bản',
  Keyword: 'Từ khóa',
  Contribution: 'Đóng góp',
  Prerequisite: 'Nền tảng',
  Tool: 'Công cụ',
  Domain: 'Lĩnh vực',
  Field: 'Ngành',
  Subfield: 'Phân ngành',
  Topic: 'Chủ đề',
  Author: 'Tác giả',
  Institution: 'Cơ quan',
  Claim: 'Luận điểm',
  Evidence: 'Bằng chứng',
  EvidenceLevel: 'Mức bằng chứng',
} as const;

export const PROVENANCE_LABELS: Record<KgProvenance, string> = {
  openalex: 'OpenAlex',
  paper_text: 'Văn bản bài báo',
  llm_candidate: 'Ứng viên AI',
  accepted: 'Đã chấp nhận',
};

export const edgeKey = ({ s, p, o, layer, provenance }: KgEdge) =>
  JSON.stringify([s, p, o, layer, provenance]);
