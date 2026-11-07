import type { Issue } from '@/core/schemas';
// A full Record: adding an issue type without a Vietnamese label fails the typecheck.
export const labels: Record<Issue['type'], string> = {
  SUBJECT_VERB_GAP: 'Khoảng cách chủ–vị',
  PRE_TOPIC_LENGTH: 'Phần mở đầu trước chủ đề dài',
  CLAUSE_DEPTH: 'Độ sâu mệnh đề',
  OVERLOADED_SENTENCE: 'Câu quá tải',
  PASSIVE_PROBLEMATIC: 'Câu bị động cần xem xét',
  FUZZY_VERB: 'Động từ chưa cụ thể',
  NOMINALIZATION: 'Danh từ hóa',
  WEAK_MODIFIER: 'Từ bổ nghĩa cần xem xét',
  UNSUPPORTED_INTENSIFIER: 'Từ nhấn mạnh cần xem xét',
  JARGON_UNEXPLAINED: 'Thuật ngữ chưa giải thích',
  REDUNDANT_PHRASE: 'Cụm từ dài',
  METADISCOURSE: 'Cụm dẫn nhập',
  OFF_TOPIC_SENTENCE: 'Câu lạc đề',
  CENTRAL_POINT_WEAK: 'Ý chính chưa rõ',
  FLOW_BREAK_CANDIDATE: 'Đứt mạch giữa hai câu',
  UNEXPLAINED_TOPIC_SHIFT: 'Chuyển chủ đề chưa giải thích',
  STRESS_TOPIC_MISALIGNMENT: 'Stress không nối Topic',
  MEANING_RISK: 'Rủi ro sai nghĩa',
};
export const statuses: Record<Issue['status'], string> = {
  candidate: 'Ứng viên cần xem lại',
  confirmed_by_model: 'AI cho là có vấn đề',
  confirmed_by_human: 'Đã xác nhận',
  dismissed_by_human: 'Đã bỏ qua',
};
