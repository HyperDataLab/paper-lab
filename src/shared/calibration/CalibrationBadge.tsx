import { AlertCircle, CheckCircle2, CircleHelp } from 'lucide-react';
import { calibrationStatus } from '@/core/calibration';
import { Badge } from '@/shared/ui/Badge';
export function CalibrationBadge({ stats }: { stats?: { n: number; wilsonLow: number | null } }) {
  const value = stats ?? { n: 0, wilsonLow: null };
  const status = calibrationStatus(value);
  const Icon = status === 'reliable' ? CheckCircle2 : status === 'unreliable' ? AlertCircle : CircleHelp;
  return (
    <Badge
      tone={status === 'reliable' ? 'success' : status === 'unreliable' ? 'danger' : 'warning'}
      icon={<Icon size={14} aria-hidden="true" />}
    >
      {status === 'reliable' ? 'Đáng tin' : status === 'unreliable' ? 'Chưa đáng tin' : 'Chưa hiệu chuẩn'} (n=
      {value.n})
    </Badge>
  );
}
