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
  inTopic: 'thuộc',
  broader: 'thuộc nhóm rộng hơn',
  authoredBy: 'có tác giả',
  affiliatedWith: 'có cơ quan công tác',
  hasClaim: 'nêu luận điểm',
  supportedBy: 'được củng cố bởi',
  evidenceLevel: 'có mức bằng chứng',
};

export const PROVENANCE_LABELS: Record<KgProvenance, string> = {
  openalex: 'OpenAlex',
  paper_text: 'Văn bản bài báo',
  llm_candidate: 'Ứng viên AI',
  accepted: 'Đã chấp nhận',
};

export const edgeKey = ({ s, p, o, layer, provenance }: KgEdge) =>
  JSON.stringify([s, p, o, layer, provenance]);
