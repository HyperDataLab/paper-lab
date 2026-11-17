import { useState } from 'react';
import { emptyTopicCheck, type TopicCheck } from '@/core/schemas/topicCheck';
import { Button } from '@/shared/ui/Button';
import { Select } from '@/shared/ui/Select';
import { LAB_RESEARCH_URL } from '@/shared/labResearch';
import { Empty, Loading } from '@/shared/ui/StateNote';
import { useToast } from '@/shared/ui/toastContext';
import { useResearchDesign } from '../ResearchDesignProvider';
import { TrackPicker } from '../topic/TrackPicker';
import { StatementCard } from '../topic/StatementCard';
import { NeighboursEditor } from '../topic/NeighboursEditor';
import { DebateCard } from '../topic/DebateCard';
import { ConvergenceCard } from '../topic/ConvergenceCard';
import { PicoCard } from '../topic/PicoCard';
import { PlainSummaryCard } from '../topic/PlainSummaryCard';
import { ChecklistCard } from '../topic/ChecklistCard';
import { DecisionCard } from '../topic/DecisionCard';
import { EvidencePanel } from '../topic/EvidencePanel';

export default function TopicSection() {
  const state = useResearchDesign();
  const toast = useToast();
  const [question, setQuestion] = useState('');
  const [showPico, setShowPico] = useState(false);
  if (state.loading) return <Loading />;
  if (state.error) return <Empty title="Không tải được đề tài." />;
  const check = state.design.topicCheck ?? emptyTopicCheck();
  const change = (fn: (check: TopicCheck) => TopicCheck) => {
    void state
      .update((design) => ({
        ...design,
        topicCheck: { ...fn(design.topicCheck ?? emptyTopicCheck()), updatedAt: new Date().toISOString() },
      }))
      .catch(() => toast('Không thể lưu thay đổi. Vui lòng thử lại.'));
  };
  const props = { check, change };
  return (
    <>
      <h3>Đề tài và khoảng trống</h3>
      <p>Đề tài, khoảng trống và câu hỏi thuộc về nhà nghiên cứu; các công cụ sau này chỉ đưa ra đầu mối.</p>
      {!LAB_RESEARCH_URL && <p>Máy chủ nghiên cứu của lab chưa được cấu hình.</p>}
      <TrackPicker {...props} />
      <StatementCard {...props} />
      <NeighboursEditor {...props} />
      <DebateCard {...props} />
      <EvidencePanel {...props} />
      <ConvergenceCard {...props} />
      {check.track === 'study' && (
        <Button variant="ghost" onClick={() => setShowPico(!showPico)}>
          {showPico ? 'Ẩn PICO' : 'Thêm PICO (tuỳ chọn)'}
        </Button>
      )}
      {(check.track === 'review' || showPico) && <PicoCard {...props} />}
      <PlainSummaryCard {...props} />
      <ChecklistCard {...props} />
      <DecisionCard {...props} />
      <Select label="Chọn câu hỏi" value={question} onChange={(e) => setQuestion(e.target.value)}>
        <option value="">Chọn câu hỏi</option>
        {state.design.draft.questions.map((q) => (
          <option key={q.id} value={q.id}>
            {q.text}
          </option>
        ))}
      </Select>
      <Button
        disabled={!question || !check.statement.trim()}
        onClick={() => {
          void state
            .update((design) => ({
              ...design,
              draft: {
                ...design.draft,
                questions: design.draft.questions.map((q) =>
                  q.id === question ? { ...q, gap: design.topicCheck?.statement ?? '' } : q,
                ),
              },
            }))
            .catch(() => toast('Không thể lưu khoảng trống. Vui lòng thử lại.'));
        }}
      >
        Dùng làm khoảng trống cho câu hỏi
      </Button>
    </>
  );
}
