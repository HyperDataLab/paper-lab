import type { FactRequestState } from '@/shared/pdfStore/factRequests';

export const STATE_LABELS: Record<FactRequestState, string> = {
  requested: 'Đang chờ',
  approved: 'Đã duyệt',
  declined: 'Đã từ chối',
  done: 'Đã xong',
};
export const STATE_TONES = {
  requested: 'warning',
  approved: 'accent',
  declined: 'neutral',
  done: 'success',
} as const satisfies Record<FactRequestState, string>;
