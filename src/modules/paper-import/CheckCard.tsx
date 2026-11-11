import type { CheckResult, Finding, Paper, PaperChecksRecord } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Card } from '@/shared/ui/Card';
import { CHECK_STATUSES, type CheckHandlers } from './checkTypes';
import { FindingRow } from './CheckFinding';
import { CalibrationBadge } from '@/shared/calibration/CalibrationBadge';
import styles from './page.module.css';
const FOLD_AFTER = 5;

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
  // The same message on many findings is said once, above the places it applies to.
  const rows = (findings: Finding[]) =>
    [...new Set(findings.map((finding) => finding.message))].map((message) => {
      const group = findings.filter((finding) => finding.message === message);
      return (
        <div key={message} className={styles.findingGroup}>
          {group.length > 1 && (
            <p className={styles.findingMessage}>
              {message} ({group.length})
            </p>
          )}
          <ul className={styles.findingList}>
            {group.map((finding) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                label={check.label}
                hideMessage={group.length > 1}
                paper={paper}
                decision={decision(finding.id)}
                onReview={onReview}
                onLocation={onLocation}
              />
            ))}
          </ul>
        </div>
      );
    });
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
      {active.length > FOLD_AFTER ? (
        <details>
          <summary>Xem {active.length} phát hiện</summary>
          {rows(active)}
        </details>
      ) : (
        rows(active)
      )}
      {dismissed.length > 0 && (
        <details>
          <summary>Đã bác bỏ ({dismissed.length})</summary>
          {rows(dismissed)}
        </details>
      )}
    </Card>
  );
}
