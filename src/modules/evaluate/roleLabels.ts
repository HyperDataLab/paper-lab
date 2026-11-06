import type { SentenceAnnotation } from '@/core/schemas';
import type { FlowLink, ParagraphMetrics } from '@/core/schemas/paragraph';

export const roleLabels: Record<NonNullable<SentenceAnnotation['role']>, string> = {
  topic_sentence: 'Câu chủ đề',
  development: 'Phát triển',
  lead: 'Dẫn dắt',
  resolution: 'Kết luận',
  opening: 'Mở đầu',
  challenge: 'Thách thức',
  action: 'Hành động',
  transition: 'Chuyển ý',
  off_topic: 'Lạc đề',
  unknown: 'Chưa rõ',
};

export const continuityLabels: Record<FlowLink['continuity'], string> = {
  stress_to_topic: 'Stress → Topic',
  topic_to_topic: 'Topic → Topic',
  derived: 'Phái sinh',
  shift: 'Chuyển chủ đề',
};

export const relationLabels: Record<FlowLink['discourseRelation'], string> = {
  elaboration: 'Giải thích thêm',
  cause: 'Nguyên nhân',
  contrast: 'Đối lập',
  example: 'Ví dụ',
  sequence: 'Trình tự',
  restatement: 'Nhắc lại',
  other: 'Khác',
  none: 'Không có',
};

type FractionKey = Exclude<keyof ParagraphMetrics, 'topic_continuity_pattern'>;
/** Vietnamese label, unit noun, and whether a percentage is meaningful. */
export const metricLabels: Record<FractionKey, { label: string; unit: string; percent: boolean }> = {
  sentence_role_coverage: { label: 'Câu có vai trò rõ', unit: 'câu', percent: true },
  off_topic_sentence_count: { label: 'Câu lạc đề', unit: 'câu', percent: false },
  stress_to_next_topic_alignment: { label: 'Cặp nối Stress → Topic', unit: 'cặp', percent: true },
  unexplained_topic_shift_count: { label: 'Chuyển chủ đề chưa giải thích', unit: 'cặp', percent: false },
  discourse_relation_coverage: { label: 'Cặp có quan hệ diễn ngôn', unit: 'cặp', percent: true },
  central_point_identifiability: { label: 'Mức rõ của ý chính', unit: '', percent: false },
};

export const identifiabilityLabels = [
  'Không nhận biết',
  'Rất khó nhận biết',
  'Nhận biết một phần',
  'Khá rõ',
  'Rất rõ',
] as const;
