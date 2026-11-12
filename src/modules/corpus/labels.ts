import type { PrismaBoxKey } from '@/core/corpus/prisma';
import type { ScreeningReasonCode } from '@/core/corpus/screening';

export const kinds = { journal: 'Journal', topic: 'Chủ đề', control: 'Đối chứng' };

/** The names the paper page uses for the same analyses. */
export const schemeNames = { rhetoric: 'Validity và Moves', stance: 'Giọng văn', arguments: 'Lập luận' };

export const reasonLabels: Record<ScreeningReasonCode, string> = {
  wrong_population: 'Sai quần thể',
  wrong_topic: 'Sai chủ đề',
  wrong_outcome: 'Sai kết cục',
  wrong_design: 'Sai thiết kế nghiên cứu',
  not_peer_reviewed: 'Không qua bình duyệt',
  duplicate: 'Trùng lặp',
  not_english: 'Không phải tiếng Anh',
  full_text_unavailable: 'Không có toàn văn',
  other: 'Lý do khác',
};

export const decisionLabels = { include: 'Chọn', exclude: 'Loại', uncertain: 'Chưa rõ' } as const;
export const stageLabels = { 'title-abstract': 'Tiêu đề và tóm tắt', 'full-text': 'Toàn văn' } as const;

export const prismaLabels: Record<PrismaBoxKey, string> = {
  identified: 'Bản ghi tìm được từ cơ sở dữ liệu',
  identifiedOtherMethods: 'Bản ghi tìm được qua trích dẫn',
  duplicatesRemoved: 'Bản ghi trùng đã loại',
  awaitingDuplicateCheck: 'Bản ghi chờ xác nhận trùng',
  recordsOutsideSearches: 'Bài thêm ngoài lượt tìm kiếm',
  recordsScreened: 'Bản ghi đã sàng lọc (tiêu đề và tóm tắt)',
  awaitingScreening: 'Bản ghi chưa sàng lọc',
  excludedTitleAbstract: 'Bản ghi bị loại ở tiêu đề và tóm tắt',
  uncertainTitleAbstract: 'Bản ghi chưa rõ ở tiêu đề và tóm tắt',
  reportsSought: 'Báo cáo cần tìm toàn văn',
  reportsNotRetrieved: 'Báo cáo không lấy được',
  awaitingFullText: 'Báo cáo chờ đọc toàn văn',
  reportsAssessed: 'Báo cáo được đánh giá đủ điều kiện',
  reportsExcluded: 'Báo cáo bị loại, kèm lý do',
  uncertainFullText: 'Báo cáo chưa rõ ở toàn văn',
  studiesIncluded: 'Nghiên cứu được đưa vào tổng quan',
};

export const decisionErrors = {
  'unknown-member': 'Không tìm thấy bài này trong corpus.',
  'person-required': 'Nhập tên người quyết định.',
  'reason-required': 'Chọn lý do loại.',
  'reason-text-required': 'Lý do khác cần ghi chú.',
  'full-text-before-include': 'Chỉ sàng lọc toàn văn cho bài đã chọn ở bước tiêu đề và tóm tắt.',
  'suggestion-mismatch': 'Gợi ý AI không khớp quyết định.',
} as const;
