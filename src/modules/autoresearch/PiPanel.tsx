import type { PiDecision } from '@/core/autoresearch/reviews';
import { Badge } from '@/shared/ui/Badge';
import { Card } from '@/shared/ui/Card';
import { actions, stageLabels } from './labels';

export function PiPanel({ decision, names }: { decision: PiDecision; names?: Map<string, string> }) {
  return (
    <Card>
      <h4>Đề xuất của PI</h4>
      <Badge tone="accent">{actions[decision.action]}</Badge>
      <p>{decision.rationale}</p>
      <p>
        Độ tin cậy theo PI{' '}
        {decision.confidence === null
          ? 'chưa xác định'
          : decision.confidence.toLocaleString('vi-VN', { style: 'percent', maximumFractionDigits: 1 })}
        .
      </p>
      {decision.target && <p>Quay lại {stageLabels[decision.target]}</p>}
      {decision.note && <p>{decision.note}</p>}
      {!!decision.selectionIds.length && names && (
        <ul>
          {decision.selectionIds.flatMap((id) => (names.has(id) ? [<li key={id}>{names.get(id)}</li>] : []))}
        </ul>
      )}
      <h5>Phương án đã cân nhắc</h5>
      <ul>
        {decision.options.map((option, index) => (
          <li key={index}>
            <strong>{actions[option.action]}</strong> · {option.rationale}
          </li>
        ))}
      </ul>
      {!!decision.answers.length && (
        <>
          <h5>Trả lời Critic</h5>
          <ul>
            {decision.answers.map((answer) => (
              <li key={answer.pointId}>{answer.response}</li>
            ))}
          </ul>
        </>
      )}
      {!!decision.handoff.length && (
        <>
          <h5>Bàn giao cho stage tiếp theo</h5>
          <ul>
            {decision.handoff.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
