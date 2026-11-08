import type { Section } from '@/core/schemas';

export const SECTION_ROLE_LABELS: Record<Section['role'], string> = {
  title: 'Tiêu đề',
  abstract: 'Tóm tắt',
  introduction: 'Mở đầu',
  methods: 'Phương pháp',
  results: 'Kết quả',
  discussion: 'Bàn luận',
  conclusion: 'Kết luận',
  related_work: 'Tổng quan tài liệu',
  references: 'Tài liệu tham khảo',
  appendix: 'Phụ lục',
  other: 'Khác',
};
