import type { Stage, StageError } from '@/core/autoresearch/contracts';
import type { EndReason, StageState } from '@/core/autoresearch/record';
import type { CriticReport, PiDecision } from '@/core/autoresearch/reviews';

export const stageLabels: Record<Stage, string> = {
  S1: 'Charter và mục tiêu',
  S2: 'Phân rã câu hỏi',
  S3: 'Chiến lược tìm kiếm',
  S4: 'Tập bài báo',
  S5: 'Sàng lọc',
  S6: 'Thẻ kiến thức',
  S7: 'Tổng hợp',
  S8: 'Hypotheses',
  S9: 'Argument map',
  S10: 'Experiment design',
  S11: 'Đóng băng kế hoạch',
  S12: 'Results và statistical analysis',
};
export const stageStates: Record<StageState['state'], string> = {
  idle: 'Chưa chạy',
  working: 'Đang thực hiện',
  gate: 'Chờ duyệt',
  accepted: 'Đã duyệt',
  rejected: 'Đã từ chối',
  stale: 'Đã cũ',
};
export const actions: Record<PiDecision['action'], string> = {
  accept: 'Duyệt',
  send_back: 'Quay lại stage trước',
  rerun: 'Chạy lại',
  stop: 'Dừng',
  escalate: 'Xin quyết định',
};
export const verdicts: Record<CriticReport['verdict'], string> = {
  sound: 'Chưa phát hiện vấn đề',
  concerns: 'Có điểm cần xem lại',
  serious: 'Có vấn đề nghiêm trọng',
};
export const endLabels: Record<EndReason, string> = {
  complete: 'Hoàn tất',
  with_gaps: 'Hoàn tất, còn điểm chưa xử lý',
  cancelled: 'Đã huỷ',
  failed: 'Đã kết thúc vì lỗi',
};
export const charterLabels = {
  question: 'Research question',
  objectives: 'Mục tiêu',
  scope_in: 'Trong phạm vi',
  scope_out: 'Ngoài phạm vi',
  success_criteria: 'Tiêu chí thành công',
  kill_criteria: 'Tiêu chí dừng',
  constraints: 'Ràng buộc',
  risk_posture: 'Research design',
};
export const obligationStatus = { open: 'Đang mở', controlled: 'Đã xử lý', unresolved: 'Chưa xử lý' };
export const stageErrors: Record<StageError, string> = {
  INVALID_GOAL: 'Mục tiêu chưa thể nghiên cứu hoặc chưa giữ đúng tiêu chí của charter.',
  TOPIC_BELOW_THRESHOLD: 'Topic chưa đạt ngưỡng heuristic hoặc còn tiêu chí chưa xác định.',
  INVALID_SEARCH_PLAN: 'Kiểm tra lại truy vấn, liên kết với câu hỏi và khoảng năm.',
  NO_LITERATURE: 'Không tìm thấy bài báo nào. Hãy xem lại truy vấn hoặc tập bài của Project.',
  EMPTY_SHORTLIST: 'Không có bài nào được đề xuất đưa vào danh sách ngắn.',
  INVALID_CARDS: 'Thẻ kiến thức có liên kết hoặc nội dung chưa đối chiếu được.',
  NO_CARDS: 'Chưa có thẻ kiến thức từ Full text hoặc Abstract của các bài được giữ lại.',
  INVALID_SYNTHESIS: 'Tổng hợp chưa bao quát các thẻ hoặc còn thông tin chưa có Evidence.',
  INVALID_HYPOTHESES: 'Kiểm tra liên kết, Evidence và sự khác biệt giữa các hypotheses.',
  INVALID_ARGUMENT_MAP: 'Kiểm tra liên kết Evidence, Claim và Hypothesis trong Argument map.',
  INVALID_DESIGN: 'Kiểm tra hypotheses, tham chiếu Writing Bank và khoá trích dẫn trong thiết kế.',
  INVALID_RESULTS: 'Results hoặc phần diễn giải chưa đối chiếu được với bảng thống kê.',
  LLM_OUTPUT_INVALID: 'Phản hồi AI chưa đúng cấu trúc.',
  LLM_TIMEOUT: 'Model phản hồi quá thời gian chờ.',
  LLM_RATE_LIMITED: 'Endpoint đang giới hạn số lượt gọi.',
  MISSING_INPUT: 'Stage thiếu đầu vào đã duyệt.',
  STAGE_ERROR: 'Không thể hoàn tất stage.',
};
