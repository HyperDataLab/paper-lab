import { AlertCircle, AlertTriangle, CheckCircle2, MinusCircle } from 'lucide-react';
import type { CheckDecision, Finding } from '@/core/schemas';
export const CHECK_STATUSES = {
  pass: { label: 'Đạt', tone: 'success', icon: CheckCircle2 },
  warn: { label: 'Cảnh báo', tone: 'warning', icon: AlertTriangle },
  fail: { label: 'Không đạt', tone: 'danger', icon: AlertCircle },
  not_applicable: { label: 'Không áp dụng', tone: 'neutral', icon: MinusCircle },
} as const;
export type CheckHandlers = {
  onReview: (id: string, status: CheckDecision['status'] | 'candidate') => void;
  onLocation: (location: Finding['locations'][number]) => void;
};
