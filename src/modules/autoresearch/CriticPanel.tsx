import type { Stage } from '@/core/autoresearch/contracts';
import type { CriticReport, Obligation } from '@/core/autoresearch/reviews';
import { Badge } from '@/shared/ui/Badge';
import { Card } from '@/shared/ui/Card';
import { obligationStatus, verdicts } from './labels';

const severity = { info: 'Ghi nhận', concern: 'Cần xem lại', serious: 'Nghiêm trọng' };
const fixes = { fix: 'Có thể sửa', needs_evidence: 'Cần Evidence', later: 'Xem lại sau' };
const lenses = { charter: 'Charter', risk: 'Rủi ro', directive: 'Chỉ dẫn', integrity: 'Tính toàn vẹn' };
export function CriticPanel({
  report,
  stage,
  obligations,
}: {
  report: CriticReport;
  stage: Stage;
  obligations: Obligation[];
}) {
  const checks = obligations.filter(
    (item) => item.targetStage === stage || report.points.some((p) => p.ref === `risk:${item.id}`),
  );
  return (
    <Card>
      <h4>Báo cáo Critic</h4>
      <Badge
        tone={report.verdict === 'serious' ? 'danger' : report.verdict === 'concerns' ? 'warning' : 'neutral'}
      >
        {verdicts[report.verdict]}
      </Badge>
      {!!report.points.length && (
        <ul>
          {report.points.map((point) => (
            <li key={point.id}>
              <strong>{lenses[point.lens]}</strong> · {severity[point.severity]} · {fixes[point.fixClass]}
              <p>{point.text}</p>
              <details>
                <summary>Tham chiếu</summary>
                {point.ref}
              </details>
            </li>
          ))}
        </ul>
      )}
      {!!report.resolutions.length && (
        <>
          <h5>Đối chiếu lần trước</h5>
          <ul>
            {report.resolutions.map((r) => (
              <li key={r.pointId}>
                {r.status === 'resolved' ? 'Đã giải quyết' : 'Giữ nguyên'} · {r.note}
              </li>
            ))}
          </ul>
        </>
      )}
      <h5>Kiểm tra nghĩa vụ</h5>
      {checks.length ? (
        <ul>
          {checks.map((item) => (
            <li key={item.id}>
              {item.text} · {obligationStatus[item.status]}
            </li>
          ))}
        </ul>
      ) : (
        <p>Không có nghĩa vụ đến hạn ở stage này.</p>
      )}
    </Card>
  );
}
