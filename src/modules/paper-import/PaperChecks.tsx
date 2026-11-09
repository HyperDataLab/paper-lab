import type { Paper, PaperChecksRecord } from '@/core/schemas';
import { ActionBar } from '@/shared/ui/ActionBar';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { CheckCard } from './CheckCard';
import type { CheckHandlers } from './checkTypes';
import { useState } from 'react';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { useCalibration } from '@/shared/calibration/useCalibration';
import { calibrationStatus } from '@/core/calibration';
import { Checkbox } from '@/shared/ui/Checkbox';
type Props = CheckHandlers & { paper: Paper; record: PaperChecksRecord | undefined; onRun: () => void };
export function PaperChecks({ paper, record, onRun, onReview, onLocation }: Props) {
  const [hide, setHide] = useState(false);
  const repo = useRepositories();
  const calibration = useCalibration(repo, record);
  const stats = (id: string) => calibration?.stats.find((row) => row.kind === 'check' && row.type === id);
  return (
    <>
      <Card>
        <h2>Kiểm tra</h2>
        <p>Các kiểm tra tự động là thử nghiệm, có thể báo nhầm; hãy xác nhận hoặc bỏ qua từng mục.</p>
        <ActionBar
          status={
            record
              ? `Lần chạy gần nhất: ${new Date(record.report.generatedAt).toLocaleString('vi-VN')}`
              : 'Chưa chạy kiểm tra.'
          }
        >
          <Checkbox checked={hide} onChange={(event) => setHide(event.target.checked)}>
            Ẩn mục chưa đáng tin
          </Checkbox>
          <Button variant="primary" onClick={onRun}>
            Chạy kiểm tra
          </Button>
        </ActionBar>
      </Card>
      {record?.report.checks
        .filter(
          (check) =>
            !hide || calibrationStatus(stats(check.id) ?? { n: 0, wilsonLow: null }) !== 'unreliable',
        )
        .map((check) => (
          <CheckCard
            key={check.id}
            check={check}
            calibration={stats(check.id)}
            record={record}
            paper={paper}
            onReview={onReview}
            onLocation={onLocation}
          />
        ))}
    </>
  );
}
