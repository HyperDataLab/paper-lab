import type { Issue, TextAnalysis } from '@/core/schemas';
import { sliceCp } from '@/core/text';
import { Card } from '@/shared/ui/Card';

const labels: Partial<Record<Issue['type'], string>> = {
  SUBJECT_VERB_GAP: 'Khoảng cách chủ–vị',
  CLAUSE_DEPTH: 'Độ sâu mệnh đề',
  FUZZY_VERB: 'Động từ chưa cụ thể',
  NOMINALIZATION: 'Danh từ hóa',
  WEAK_MODIFIER: 'Từ bổ nghĩa cần xem xét',
  UNSUPPORTED_INTENSIFIER: 'Từ nhấn mạnh cần xem xét',
  REDUNDANT_PHRASE: 'Cụm từ dài',
  METADISCOURSE: 'Cụm dẫn nhập',
  PASSIVE_PROBLEMATIC: 'Câu bị động cần xem xét',
};
const severities: Record<Issue['severity'], string> = {
  critical: 'Nghiêm trọng',
  major: 'Lớn',
  moderate: 'Vừa',
  minor: 'Nhỏ',
  info: 'Thông tin',
};
export function CandidateList({ issues, text }: { issues: Issue[]; text: TextAnalysis }) {
  return (
    <Card>
      <h2>Ứng viên vấn đề ({issues.length})</h2>
      <p>Đây là ứng viên cần xem xét, không phải lỗi đã khẳng định.</p>
      {(['structure', 'word'] as const).map((category) => {
        const group = issues.filter((item) => item.category === category);
        return (
          group.length > 0 && (
            <section key={category}>
              <h3>{category === 'structure' ? 'Cấu trúc câu' : 'Từ ngữ'}</h3>
              <ul>
                {group.map((item) => (
                  <li key={item.id}>
                    <strong>{labels[item.type] ?? item.type}</strong> ·{' '}
                    {item.spans
                      .map((span) => `“${sliceCp(text.sourceText, span.start, span.end)}”`)
                      .join(' / ')}{' '}
                    ·{' '}
                    {item.metric.value !== null &&
                      `${item.metric.value} ${item.metric.unit === 'tokens' ? 'token' : item.metric.unit === 'candidate' ? 'ứng viên' : (item.metric.unit ?? '')} · `}
                    {severities[item.severity]} ·{' '}
                    <span>
                      {item.status === 'confirmed_by_model'
                        ? '✓ AI cho là có vấn đề'
                        : item.severity === 'info'
                          ? '✓ AI cho là chấp nhận được'
                          : '○ Ứng viên'}
                    </span>
                    <p>{item.why}</p>
                    {item.suggestedFix && <p>Gợi ý: {item.suggestedFix}</p>}
                    <p>{item.sourcePrinciple}</p>
                  </li>
                ))}
              </ul>
            </section>
          )
        );
      })}
    </Card>
  );
}
