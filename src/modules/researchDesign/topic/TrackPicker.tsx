import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import type { Props } from './types';
export function TrackPicker({ check, change }: Props) {
  return (
    <SegmentedControl
      label="Loại nghiên cứu"
      showLabel
      value={check.track}
      options={[
        { value: 'review', label: 'Tổng quan hệ thống' },
        { value: 'study', label: 'Nghiên cứu thực nghiệm' },
      ]}
      onChange={(value) => change((c) => ({ ...c, track: value === 'review' ? 'review' : 'study' }))}
    />
  );
}
