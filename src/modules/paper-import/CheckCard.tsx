import type { CheckResult, Finding, Paper, PaperChecksRecord } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Card } from '@/shared/ui/Card';
import { CHECK_STATUSES, type CheckHandlers } from './checkTypes';
import { FindingRow } from './CheckFinding';
import { CalibrationBadge } from '@/shared/calibration/CalibrationBadge';
export function CheckCard({
  check,
  record,
  paper,
  onReview,
  onLocation,
  calibration,
}: {
  check: CheckResult;
  record: PaperChecksRecord;
  paper: Paper;
  onReview: CheckHandlers['onReview'];
  onLocation: CheckHandlers['onLocation'];
  calibration?: { n: number; wilsonLow: number | null };
}) {
  const status = CHECK_STATUSES[check.status];
  const Icon = status.icon;
  const decision = (id: string) => record.decisions.find((d) => d.findingId === id);
  const active = check.findings.filter((f) => decision(f.id)?.status !== 'dismissed_by_human');
  const dismissed = check.findings.filter((f) => decision(f.id)?.status === 'dismissed_by_human');
  const rows = (findings: Finding[]) => (
    <ul>
      {findings.map((finding) => (
        <FindingRow
          key={finding.id}
          finding={finding}
          paper={paper}
          decision={decision(finding.id)}
          onReview={onReview}
          onLocation={onLocation}
        />
      ))}
    </ul>
  );
  return (
    <Card>
      <h2>{check.label}</h2>
      <Badge tone={status.tone} icon={<Icon size={16} aria-hidden="true" />}>
        {status.label}
      </Badge>{' '}
      <CalibrationBadge stats={calibration} />
      <p>{check.summary}</p>
      <details>
        <summary>Nguy cơ báo nhầm</summary>
        <ul>
          {check.falsePositiveNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </details>
      {rows(active)}
      {dismissed.length > 0 && (
        <details>
          <summary>Đã bỏ qua ({dismissed.length})</summary>
          {rows(dismissed)}
        </details>
      )}
    </Card>
  );
}
