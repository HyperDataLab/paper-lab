import {
  MMAT_CATEGORIES,
  type AppraisalError,
  type MmatCategory,
  type MmatCriterion,
  type MmatJudgement,
} from '@/core/corpus/appraisal';

/** Short Vietnamese paraphrases of the MMAT 2018 items; the tool's own wording is not reproduced. */
const VI: Record<string, string> = {
  S1: 'Câu hỏi nghiên cứu rõ ràng',
  S2: 'Dữ liệu trả lời được câu hỏi',
  '1.1': 'Cách tiếp cận định tính phù hợp',
  '1.2': 'Cách thu thập dữ liệu đủ',
  '1.3': 'Kết quả rút ra từ dữ liệu',
  '1.4': 'Diễn giải có dữ liệu đỡ',
  '1.5': 'Nhất quán từ dữ liệu đến diễn giải',
  '2.1': 'Ngẫu nhiên hoá đúng cách',
  '2.2': 'Các nhóm tương đương lúc đầu',
  '2.3': 'Dữ liệu kết cục đầy đủ',
  '2.4': 'Người đánh giá kết cục bị che',
  '2.5': 'Người tham gia theo đúng can thiệp',
  '3.1': 'Người tham gia đại diện',
  '3.2': 'Đo lường phù hợp',
  '3.3': 'Dữ liệu kết cục đầy đủ',
  '3.4': 'Đã tính đến yếu tố nhiễu',
  '3.5': 'Can thiệp hoặc phơi nhiễm đúng dự định',
  '4.1': 'Cách chọn mẫu phù hợp',
  '4.2': 'Mẫu đại diện',
  '4.3': 'Đo lường phù hợp',
  '4.4': 'Ít nguy cơ sai lệch do không trả lời',
  '4.5': 'Phân tích thống kê phù hợp',
  '5.1': 'Có lý do dùng phương pháp hỗn hợp',
  '5.2': 'Các thành phần được tích hợp',
  '5.3': 'Kết quả tích hợp được diễn giải',
  '5.4': 'Xử lý chỗ khác biệt giữa các thành phần',
  '5.5': 'Mỗi thành phần đạt tiêu chí của nó',
};
export const criterionLabel = (item: MmatCriterion) => `${item.id} ${VI[item.id] ?? ''} (${item.short})`;

export const categoryLabels: Record<MmatCategory, string> = {
  qualitative: 'Định tính',
  'quantitative-randomised': 'Định lượng có ngẫu nhiên',
  'quantitative-non-randomised': 'Định lượng không ngẫu nhiên',
  'quantitative-descriptive': 'Định lượng mô tả',
  'mixed-methods': 'Hỗn hợp',
};
export const categoryLabel = (id: MmatCategory) => {
  const index = MMAT_CATEGORIES.findIndex((category) => category.id === id);
  return `${index + 1}. ${categoryLabels[id]} (${MMAT_CATEGORIES[index]?.short ?? id})`;
};

export const judgementLabels: Record<MmatJudgement, string> = {
  yes: 'Có',
  no: 'Không',
  cant_tell: 'Không rõ',
};

export const appraisalErrors: Record<AppraisalError, string> = {
  'unknown-member': 'Không tìm thấy bài này trong corpus.',
  'not-included': 'Chỉ đánh giá bài đã được chọn ở bước toàn văn.',
  'appraiser-required': 'Nhập tên người đánh giá.',
  'category-required': 'Chọn loại nghiên cứu.',
  'answers-incomplete': 'Trả lời đủ hai câu sàng lọc và năm tiêu chí.',
};
