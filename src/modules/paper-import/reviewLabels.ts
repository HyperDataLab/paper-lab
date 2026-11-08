import type { Lens } from '@/core/prompts';
import type { PaperReviewRun } from '@/core/schemas';

export const LENS_DESCRIPTIONS: Record<Lens, string> = {
  methods_skeptic: 'Xem phương pháp và bằng chứng có hỗ trợ các khẳng định hay không.',
  clarity_editor: 'Xem độ rõ ràng và mạch ý theo nguyên tắc Writing Science.',
  reproducibility_auditor: 'Xem mô tả quy trình và vật liệu có đủ để tái lập hay không.',
  newcomer_reader: 'Đọc như người ngoài chuyên ngành, tìm chỗ cần thêm ngữ cảnh.',
  limitations_ethics: 'Xem các giới hạn và khía cạnh đạo đức được trình bày.',
};
type Point = PaperReviewRun['merged'][number]['wordings'][number];
export const KIND_LABELS: Record<Point['kind'], string> = {
  strength: 'Điểm mạnh',
  weakness: 'Điểm yếu',
  question: 'Câu hỏi',
  needs_evidence: 'Cần bằng chứng',
};
export const DIMENSION_LABELS: Record<Point['dimension'], string> = {
  soundness: 'Độ vững của khoa học',
  clarity: 'Độ rõ ràng',
  reproducibility: 'Khả năng tái lập',
  significance: 'Ý nghĩa',
  originality: 'Tính mới',
  limitations_ethics: 'Giới hạn và đạo đức',
  citations: 'Trích dẫn',
};
export const SEVERITY_LABELS: Record<Point['severity'], string> = {
  minor: 'Nhẹ',
  moderate: 'Vừa',
  major: 'Đáng kể',
};
