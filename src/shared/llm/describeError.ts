import {
  ConsentRequiredError,
  InvalidModelOutputError,
  LlmConfigError,
  LlmHttpError,
  LlmNetworkError,
  LlmTimeoutError,
} from './errors';

/** Vietnamese message for an LLM failure; null when nothing should be shown (cancelled by the user). */
export function describeLlmError(error: unknown): string | null {
  if (error instanceof ConsentRequiredError) return null;
  if (error instanceof DOMException && error.name === 'AbortError') return null;
  if (error instanceof LlmHttpError)
    return error.status === 401 ? 'Khoá không hợp lệ' : `Máy chủ trả lỗi HTTP ${error.status}`;
  if (error instanceof LlmTimeoutError) return 'Hết thời gian chờ phản hồi';
  if (error instanceof InvalidModelOutputError)
    return `Model trong combo chưa trả JSON đúng schema sau 3 lần thử. Chi tiết: ${error.issues.slice(0, 240)}`;
  if (error instanceof LlmNetworkError) return 'Không kết nối được (kiểm tra CORS hoặc mạng)';
  if (error instanceof LlmConfigError)
    return error.message === 'API key is required'
      ? 'Chưa nhập khoá API. Mở Cài đặt để nhập khoá.'
      : 'Cấu hình kết nối chưa hợp lệ (xem Cài đặt)';
  return 'Đã có lỗi không xác định';
}
