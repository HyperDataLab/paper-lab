import type { PaperChecksRecord } from '@/core/schemas';
import { Card } from '@/shared/ui/Card';

export function OrphanedChecks({ record }: { record?: PaperChecksRecord }) {
  if (!record) return null;
  const legacy = record.decisions.filter(
    (decision) =>
      !record.report.checks.some((check) =>
        check.findings.some((finding) => finding.id === decision.findingId),
      ),
  );
  if (!legacy.length && !record.orphanedDecisions?.length) return null;
  return (
    <Card>
      <h3>Quyết định chưa ghép lại được</h3>
      <ul>
        {record.orphanedDecisions?.map(({ decision, finding }) => (
          <li key={decision.findingId}>
            {finding.message} — {finding.evidence.join('; ')} (
            {decision.status === 'dismissed_by_human' ? 'Đã bác bỏ' : 'Đã xác nhận'}) {decision.note}
          </li>
        ))}
        {legacy.map((decision) => (
          <li key={decision.findingId}>
            {decision.findingId} ({decision.status === 'dismissed_by_human' ? 'Đã bác bỏ' : 'Đã xác nhận'}){' '}
            {decision.note}
          </li>
        ))}
      </ul>
    </Card>
  );
}
