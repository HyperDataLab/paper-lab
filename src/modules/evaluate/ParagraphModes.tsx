import { useNavigate } from 'react-router-dom';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';

const MODES = [
  { value: '/evaluate', label: 'Đánh giá đoạn có sẵn' },
  { value: '/generate', label: 'Soạn đoạn mới' },
];

/** The two ways to start paragraph work. Revising starts from an analysis, so it is not offered here. */
export function ParagraphModes({ current }: { current: '/evaluate' | '/generate' }) {
  const navigate = useNavigate();
  return <SegmentedControl label="Bắt đầu với" value={current} options={MODES} onChange={navigate} />;
}
