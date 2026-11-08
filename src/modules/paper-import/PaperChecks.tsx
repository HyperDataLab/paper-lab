import type { Paper, PaperChecksRecord } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { CheckCard } from './CheckCard';
import type { CheckHandlers } from './checkTypes';
type Props = CheckHandlers & { paper: Paper; record: PaperChecksRecord | undefined; onRun: () => void };
export function PaperChecks({ paper, record, onRun, onReview, onLocation }: Props) {
  return (
    <>
      <Card>
        <h2>Kiểm tra</h2>
        <p>Các kiểm tra tự động là thử nghiệm, có thể báo nhầm; hãy xác nhận hoặc bỏ qua từng mục.</p>
        <Button variant="primary" onClick={onRun}>
          Chạy kiểm tra
        </Button>
        <p>
          {record
            ? `Lần chạy gần nhất: ${new Date(record.report.generatedAt).toLocaleString('vi-VN')}`
            : 'Chưa chạy kiểm tra.'}
        </p>
      </Card>
      {record?.report.checks.map((check) => (
        <CheckCard
          key={check.id}
          check={check}
          record={record}
          paper={paper}
          onReview={onReview}
          onLocation={onLocation}
        />
      ))}
    </>
  );
}
