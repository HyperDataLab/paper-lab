import type { CellStatus, ExtractionMode, SourceAccess } from '@/core/schemas';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export const STATUS: Record<CellStatus, { label: string; tone: Tone }> = {
  EXTRACTED: { label: 'Đã trích', tone: 'accent' },
  NEEDS_REVIEW: { label: 'Cần duyệt', tone: 'warning' },
  VERIFIED: { label: 'Đã xác nhận', tone: 'success' },
  NOT_FOUND: { label: 'Không thấy', tone: 'neutral' },
  NOT_APPLICABLE: { label: 'Không áp dụng', tone: 'neutral' },
  INSUFFICIENT_SOURCE: { label: 'Thiếu nguồn', tone: 'neutral' },
  CONFLICT: { label: 'Mâu thuẫn', tone: 'danger' },
  FAILED: { label: 'Lỗi', tone: 'danger' },
};

export const ACCESS: Record<SourceAccess, string> = {
  FULL_TEXT: 'Toàn văn',
  ABSTRACT_ONLY: 'Chỉ dùng abstract',
  METADATA_ONLY: 'Chỉ metadata',
};

export const MODES: Record<ExtractionMode, { label: string; help: string }> = {
  STANDARD: { label: 'Standard', help: 'Một lượt trích cho mỗi bài. Nhanh và ít lượt gọi nhất.' },
  HIGH_QUALITY: {
    label: 'High Quality',
    help: 'Thêm lượt kiểm chứng từng ô với nguồn và phát hiện mâu thuẫn.',
  },
  DEEP_RESEARCH: {
    label: 'Deep Research',
    help: 'Tìm thêm bài, sàng lọc và tổng hợp liên bài theo research question.',
  },
};

export const fullExtractHelp = (count: number) =>
  `Trích tất cả ${count} trường trong danh mục cho bài này (kể cả cột chưa có trong bảng). Tốn nhiều lượt gọi hơn.`;

// These hints are display copy. Field definitions are also saved in projects.
export const FIELD_HINTS: Partial<Record<string, string>> = {
  conclusions: 'Conclusion tác giả rút ra.',
  summarized_abstract: 'Tóm tắt phần abstract.',
  results: 'Results chính kèm số liệu.',
  summarized_introduction: 'Tóm tắt phần introduction.',
  methods_used: 'Methods được dùng.',
  literature_survey: 'Related work được điểm qua.',
  limitations: 'Limitations tác giả nêu.',
  contributions: 'Contributions tác giả khẳng định.',
  research_gap: 'Research gap tác giả nêu.',
  dependent_variables: 'Dependent variables.',
  independent_variables: 'Independent variables.',
  dataset: 'Dataset được dùng.',
  research_questions: 'Research questions của bài.',
  hypotheses: 'Hypotheses tác giả nêu.',
  baseline_methods: 'Baseline dùng để so sánh.',
  quantitative_results: 'Results định lượng.',
  qualitative_results: 'Results định tính.',
  ablation_study: 'Thí nghiệm ablation.',
  threats_to_validity: 'Threats to validity.',
  key_claims: 'Claims chính.',
  supporting_evidence: 'Evidence hỗ trợ claims.',
  contradictory_evidence: 'Evidence trái chiều.',
};

export const FLAGS: Record<string, string> = {
  UNSUPPORTED: 'Không có trích dẫn tìm thấy trong bài',
  EVIDENCE_NOT_FOUND: 'Có trích dẫn mô hình đưa ra không tìm thấy trong bài',
  NUMBER_NOT_IN_EVIDENCE: 'Có con số không nằm trong trích dẫn',
  INFERRED: 'Mô hình suy ra, bài không nêu trực tiếp',
  ABSTRACT_ONLY: 'Chỉ đọc từ abstract',
  METADATA_ONLY: 'Chỉ có metadata, không có văn bản để đọc',
  MISSING_IN_OUTPUT: 'Mô hình không trả về trường này',
  HUMAN_EDITED: 'Người duyệt đã sửa',
  REJECTED_BY_REVIEWER: 'Người duyệt đã bác bỏ',
  CONFLICTING_PASSAGES: 'Bài có đoạn nói khác, cần người chọn',
  VERIFIER_PARTIALLY_SUPPORTED: 'Bước kiểm chứng: chỉ một phần được nguồn hỗ trợ',
  VERIFIER_CONTRADICTED: 'Bước kiểm chứng: nguồn nói khác',
  VERIFIER_INDETERMINATE: 'Bước kiểm chứng: nguồn chưa đủ để kết luận',
  VERIFIER_SKIPPED: 'Bước kiểm chứng không trả lời cho ô này',
};

export const VERDICTS: Record<string, string> = {
  SUPPORTED: 'Nguồn hỗ trợ',
  PARTIALLY_SUPPORTED: 'Hỗ trợ một phần',
  CONTRADICTED: 'Nguồn nói khác',
  INDETERMINATE: 'Chưa kết luận được',
};
