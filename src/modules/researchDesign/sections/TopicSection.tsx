import { useRef, useState } from 'react';
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
import { BlurField } from '../topic/BlurField';
import styles from './topicSection.module.css';

export default function TopicSection() {
  const state = useResearchDesign();
  const toast = useToast();
  const [question, setQuestion] = useState('');
  const [showPico, setShowPico] = useState(false);
  const [optimisticCheck, setOptimisticCheck] = useState<TopicCheck | null>(null);
  const optimisticCheckRef = useRef<TopicCheck | null>(null);
  const changeSequence = useRef(0);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  if (state.loading) return <Loading />;
  if (state.error) return <Empty title="Không tải được đề tài." />;
  const check = optimisticCheck ?? state.design.topicCheck ?? emptyTopicCheck();
  const change = (fn: (check: TopicCheck) => TopicCheck) => {
    const updatedAt = new Date().toISOString();
    const next = { ...fn(optimisticCheckRef.current ?? check), updatedAt };
    optimisticCheckRef.current = next;
    setOptimisticCheck(next);
    const sequence = ++changeSequence.current;
    const request = writeQueue.current.then(() =>
      state.update((design) => ({
        ...design,
        topicCheck: { ...fn(design.topicCheck ?? emptyTopicCheck()), updatedAt },
      })),
    );
    writeQueue.current = request.then(
      () => undefined,
      () => undefined,
    );
    void request.then(
      () => {
        if (sequence !== changeSequence.current) return;
        optimisticCheckRef.current = null;
        setOptimisticCheck(null);
      },
      () => {
        toast('Không thể lưu thay đổi. Vui lòng thử lại.');
        if (sequence !== changeSequence.current) return;
        optimisticCheckRef.current = null;
        setOptimisticCheck(null);
      },
    );
  };
  const props = { check, change };
  return (
    <div className={styles.topicLayout}>
      <div className={styles.topicMain}>
        {!LAB_RESEARCH_URL && <p role="status">Máy chủ nghiên cứu của lab chưa được cấu hình.</p>}
        <div className={styles.trackChoice}>
          <TrackPicker {...props} />
          {check.track === 'study' && (
            <Button variant="ghost" onClick={() => setShowPico(!showPico)}>
              {showPico ? 'Ẩn PICO' : 'Thêm PICO (tuỳ chọn)'}
            </Button>
          )}
        </div>

        <section className={styles.topicGroup} aria-labelledby="topic-debate-heading">
          <header>
            <h3 id="topic-debate-heading">Đề tài và tranh luận</h3>
            <p>Định nghĩa vấn đề, nghiên cứu gần nhất và điểm còn đang tranh luận.</p>
          </header>
          <StatementCard {...props} />
          <NeighboursEditor {...props} />
          <DebateCard {...props} />
        </section>

        <section className={styles.topicGroup} aria-labelledby="topic-evidence-heading">
          <header>
            <h3 id="topic-evidence-heading">Công cụ tìm bằng chứng</h3>
            <p>Kết quả là đầu mối để mở và đọc; số liệu không thay thế đánh giá của nhà nghiên cứu.</p>
          </header>
          <EvidencePanel {...props} />
        </section>

        <section className={styles.topicGroup} aria-labelledby="topic-assessment-heading">
          <header>
            <h3 id="topic-assessment-heading">Đánh giá đề tài</h3>
            <p>Ghi nhận mức hội tụ, tính khả thi và tóm tắt ý nghĩa của hướng nghiên cứu.</p>
          </header>
          <div className={styles.assessmentPanel}>
            <div className={styles.assessmentQuickChoices}>
              <ConvergenceCard {...props} />
            </div>
            {(check.track === 'review' || showPico) && (
              <section className={styles.assessmentPico} aria-labelledby="topic-pico-heading">
                <h4 id="topic-pico-heading">Khung PICO</h4>
                <PicoCard {...props} />
              </section>
            )}
            <div className={styles.assessmentNotes}>
              <BlurField
                id="topic-feasibility"
                label="Ghi chú tính khả thi"
                value={check.convergence.feasibility}
                rows={2}
                save={(feasibility) =>
                  change((c) => ({ ...c, convergence: { ...c.convergence, feasibility } }))
                }
              />
              <PlainSummaryCard {...props} />
            </div>
          </div>
        </section>

        <section className={styles.topicGroup} aria-labelledby="topic-decision-heading">
          <header>
            <h3 id="topic-decision-heading">Quyết định và liên kết câu hỏi</h3>
            <p>Quyết định thuộc về nhà nghiên cứu; chỉ nội dung đã lưu mới được dùng tiếp.</p>
          </header>
          <DecisionCard {...props} />
          <div className={styles.linkQuestion}>
            <Select
              label="Câu hỏi nghiên cứu"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              searchable
            >
              <option value="">Chọn câu hỏi nghiên cứu</option>
              {state.design.draft.questions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.text}
                </option>
              ))}
            </Select>
            <Button
              disabled={!question || !check.statement.trim()}
              aria-describedby="topic-gap-hint"
              onClick={() => {
                void state
                  .update((design) => ({
                    ...design,
                    draft: {
                      ...design.draft,
                      questions: design.draft.questions.map((item) =>
                        item.id === question ? { ...item, gap: design.topicCheck?.statement ?? '' } : item,
                      ),
                    },
                  }))
                  .catch(() => toast('Không thể lưu research gap. Vui lòng thử lại.'));
              }}
            >
              Dùng làm research gap
            </Button>
            <p id="topic-gap-hint" role="status" className={styles.gapHint}>
              {!check.statement.trim()
                ? 'Nhập và lưu phát biểu đề tài trước khi dùng làm research gap.'
                : state.design.draft.questions.length === 0
                  ? 'Chưa có câu hỏi nghiên cứu. Thêm câu hỏi trong mục “Research questions và hypotheses”.'
                  : !question
                    ? 'Chọn một câu hỏi để áp dụng phát biểu đề tài đã lưu.'
                    : 'Phát biểu đề tài đã lưu sẽ được chép vào research gap của câu hỏi này.'}
            </p>
          </div>
        </section>
      </div>
      <aside className={styles.topicChecklist} aria-label="Trạng thái đề tài">
        <ChecklistCard check={check} />
      </aside>
    </div>
  );
}
