import type { Issue } from '@/core/schemas';
export const labels: Partial<Record<Issue['type'], string>> = {
  SUBJECT_VERB_GAP: 'Khoảng cách chủ–vị',
  CLAUSE_DEPTH: 'Độ sâu mệnh đề',
  FUZZY_VERB: 'Động từ chưa cụ thể',
  NOMINALIZATION: 'Danh từ hóa',
  WEAK_MODIFIER: 'Từ bổ nghĩa cần xem xét',
  UNSUPPORTED_INTENSIFIER: 'Từ nhấn mạnh cần xem xét',
  REDUNDANT_PHRASE: 'Cụm từ dài',
  METADISCOURSE: 'Cụm dẫn nhập',
  PASSIVE_PROBLEMATIC: 'Câu bị động cần xem xét',
};
